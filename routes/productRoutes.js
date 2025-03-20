const express = require('express');
const router = express.Router();
const { productController, upload } = require('../controllers/productController');
const protect = require('../middleware/authMiddleware');

router.get('/products', protect, productController.getProducts);
router.post('/products', protect, upload.single('image'), productController.createProduct);
router.put('/products/:id', protect, upload.single('image'), productController.updateProduct);
router.delete('/products/:id', protect, productController.deleteProduct);
router.patch('/products/:id/stock', protect, productController.updateStockStatus);

module.exports = router;