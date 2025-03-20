const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const protect = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(protect);

// Support routes
router.post('/support', supportController.submitSupport);
router.get('/support/view', supportController.getAllTickets);
router.get('/ticket/:id', supportController.getTicketById);
router.patch('/ticket/:id/status', supportController.updateTicketStatus);
router.delete('/ticket/:id', supportController.deleteTicket);

module.exports = router;

