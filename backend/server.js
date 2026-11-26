
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');

const pool = require('./db');
const authRoutes = require('./routes/authRoutes');
const verifyToken = require('./middleware/auth');

const app = express();

// ---------------- CONFIGURATION ----------------

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GOOGLE_VISION_API_KEY || AIzaSyBsvjeC0GRIdmbv3DLBC83UJRLMLlI3uqY;

// ---------------- MULTER ----------------

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 8 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        if (/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PNG, JPG or WEBP images are allowed'));
        }
    }
});

// ---------------- ENVIRONMENT CHECK ----------------

const missing = [];

if (!process.env.JWT_SECRET) {
    missing.push('JWT_SECRET');
}

if (!API_KEY) {
    missing.push('GOOGLE_VISION_API_KEY');
}

if (!process.env.MYSQL_URL && !process.env.DB_HOST) {
    missing.push('MYSQL_URL or DB_HOST');
}

if (missing.length) {
    console.error('Missing environment variables:', missing.join(', '));
}

// ---------------- MIDDLEWARE ----------------

app.use(cors());
app.use(express.json());

// ---------------- HEALTH CHECK ----------------

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');

        res.json({
            success: true,
            server: 'up',
            database: 'connected',
            googleVisionConfigured: !!API_KEY
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            server: 'up',
            database: 'disconnected',
            error: error.message
        });
    }
});

// ---------------- AUTH ROUTES ----------------

app.use('/api/auth', authRoutes);

// ---------------- GOOGLE VISION OCR ----------------

app.post(
    '/api/ocr',
    verifyToken,
    upload.single('prescription'),
    async (req, res) => {

        try {

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No prescription image uploaded'
                });
            }

            if (!API_KEY) {
                return res.status(500).json({
                    success: false,
                    error: 'Google Vision API key missing'
                });
            }

            // Convert image to Base64

            const base64Image = req.file.buffer.toString('base64');

            // Call Google Cloud Vision API

            const response = await axios.post(
                `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
                {
                    requests: [
                        {
                            image: {
                                content: base64Image
                            },
                            features: [
                                {
                                    type: 'DOCUMENT_TEXT_DETECTION'
                                }
                            ]
                        }
                    ]
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            // Extract OCR text

            const visionResult = response.data.responses?.[0];

            if (visionResult?.error) {
                throw new Error(visionResult.error.message);
            }

            const extractedText =
                visionResult?.fullTextAnnotation?.text || '';

            if (!extractedText.trim()) {
                return res.status(422).json({
                    success: false,
                    error: 'No text detected in prescription'
                });
            }

            console.log('Extracted Prescription Text:', extractedText);

            // Prepare OCR result

            const resultObj = {
                extractedText,
                provider: 'Google Cloud Vision',
                status: 'success'
            };

            // Image preview

            const imagePreview =
                `data:${req.file.mimetype};base64,${base64Image}`;

            // Save to MySQL

            const [dbResult] = await pool.query(
                `INSERT INTO prescriptions
                (user_id, file_name, image_preview, result_json)
                VALUES (?, ?, ?, ?)`,
                [
                    req.user.userId,
                    req.file.originalname,
                    imagePreview,
                    JSON.stringify(resultObj)
                ]
            );

            // Frontend response

            const newRecord = {
                id: dbResult.insertId,
                fileName: req.file.originalname,
                image: imagePreview,
                result: resultObj,
                createdAt: new Date().toISOString()
            };

            res.json({
                success: true,
                message: 'Prescription extracted successfully',
                data: newRecord
            });

        } catch (error) {

            console.error(
                '[Google Vision OCR Error]',
                JSON.stringify(
                    error.response?.data || error.message,
                    null,
                    2
                )
            );

            res.status(error.response?.status || 500).json({
                success: false,
                error:
                    error.response?.data?.error?.message ||
                    error.message ||
                    'OCR service failed'
            });
        }
    }
);

// ---------------- GET PRESCRIPTION HISTORY ----------------

app.get('/api/prescriptions', verifyToken, async (req, res) => {

    try {

        const [rows] = await pool.query(
            `SELECT
                id,
                file_name AS fileName,
                image_preview AS image,
                result_json AS result,
                created_at AS createdAt
             FROM prescriptions
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [req.user.userId]
        );

        const formattedRecords = rows.map(row => ({
            ...row,
            result:
                typeof row.result === 'string'
                    ? JSON.parse(row.result)
                    : row.result
        }));

        res.json({
            success: true,
            data: formattedRecords
        });

    } catch (error) {

        console.error('[Fetch History Error]', error);

        res.status(500).json({
            success: false,
            error: 'Failed to fetch prescription history'
        });
    }
});

// ---------------- DELETE PRESCRIPTION ----------------

app.delete('/api/prescriptions/:id', verifyToken, async (req, res) => {

    try {

        const [result] = await pool.query(
            `DELETE FROM prescriptions
             WHERE id = ? AND user_id = ?`,
            [
                req.params.id,
                req.user.userId
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Prescription not found or unauthorized'
            });
        }

        res.json({
            success: true,
            message: 'Prescription deleted successfully'
        });

    } catch (error) {

        console.error('[Delete Error]', error);

        res.status(500).json({
            success: false,
            error: 'Failed to delete prescription'
        });
    }
});

// ---------------- ERROR HANDLER ----------------

app.use((err, req, res, next) => {

    console.error('[Server Error]', err.message);

    const status =
        err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

    res.status(status).json({
        success: false,
        error:
            err.code === 'LIMIT_FILE_SIZE'
                ? 'Image must be under 8 MB'
                : err.message
    });
});

// ---------------- START SERVER ----------------

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
