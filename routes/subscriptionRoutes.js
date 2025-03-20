
const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const protect = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(protect);

// Subscription routes
router.get('/status', subscriptionController.getSubscriptionStatus);
router.post('/create-order', subscriptionController.createSubscriptionOrder);
router.post('/verify-payment', subscriptionController.verifySubscriptionPayment);

module.exports = router;