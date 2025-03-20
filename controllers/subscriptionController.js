const Subscription = require('../models/subscriptionModel');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Configure Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const subscriptionController = {
  // Get subscription status
  async getSubscriptionStatus(req, res) {
    try {
      const subscription = await Subscription.findOne({
        restaurantId: req.user.restaurantId
      }).sort({ endDate: -1 });

      if (!subscription) {
        return res.json({ status: 'inactive' });
      }

      // Check if subscription has expired
      const now = new Date();
      if (subscription.endDate < now) {
        // Update status to expired if it's not already
        if (subscription.status !== 'expired') {
          subscription.status = 'expired';
          await subscription.save();
        }
        return res.json({ status: 'expired' });
      }

      return res.json({ 
        status: subscription.status,
        plan: subscription.plan,
        endDate: subscription.endDate
      });
    } catch (error) {
      console.error('Error getting subscription status:', error);
      res.status(500).json({ message: 'Error getting subscription status' });
    }
  },

  // Create a new subscription order
  async createSubscriptionOrder(req, res) {
    try {
      const { plan } = req.body;
      
      // Define plan prices
      const planPrices = {
        basic: 49900,  // ₹499
        premium: 99900, // ₹999
        enterprise: 199900 // ₹1999
      };
      
      if (!planPrices[plan]) {
        return res.status(400).json({ message: 'Invalid plan selected' });
      }
      
      const options = {
        amount: planPrices[plan],
        currency: 'INR',
        receipt: `subscription_${req.user.restaurantId}_${Date.now()}`,
        notes: {
          restaurantId: req.user.restaurantId,
          plan: plan
        }
      };
      
      const order = await razorpay.orders.create(options);
      
      res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency
      });
    } catch (error) {
      console.error('Error creating subscription order:', error);
      res.status(500).json({ message: 'Error creating subscription order' });
    }
  },

  // Verify payment and activate subscription
  async verifySubscriptionPayment(req, res) {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature, plan } = req.body;
      
      // Verify signature
      const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
      shasum.update(`${razorpayOrderId}|${razorpayPaymentId}`);
      const digest = shasum.digest('hex');
      
      if (digest !== razorpaySignature) {
        return res.status(400).json({ message: 'Invalid payment signature' });
      }
      
      // Calculate subscription duration based on plan
      const now = new Date();
      let endDate = new Date(now);
      
      switch (plan) {
        case 'basic':
          endDate.setMonth(endDate.getMonth() + 1); // 1 month
          break;
        case 'premium':
          endDate.setMonth(endDate.getMonth() + 6); // 6 months
          break;
        case 'enterprise':
          endDate.setFullYear(endDate.getFullYear() + 1); // 1 year
          break;
        default:
          endDate.setMonth(endDate.getMonth() + 1); // Default to 1 month
      }
      
      // Create or update subscription
      let subscription = await Subscription.findOne({ 
        restaurantId: req.user.restaurantId,
        status: 'active'
      });
      
      if (subscription) {
        // If active subscription exists, extend the end date
        subscription.endDate = new Date(Math.max(subscription.endDate, endDate));
        subscription.plan = plan;
        subscription.razorpayOrderId = razorpayOrderId;
        subscription.razorpayPaymentId = razorpayPaymentId;
        subscription.razorpaySignature = razorpaySignature;
      } else {
        // Create new subscription
        subscription = new Subscription({
          restaurantId: req.user.restaurantId,
          status: 'active',
          plan: plan,
          startDate: now,
          endDate: endDate,
          razorpayOrderId: razorpayOrderId,
          razorpayPaymentId: razorpayPaymentId,
          razorpaySignature: razorpaySignature
        });
      }
      
      await subscription.save();
      
      res.json({
        success: true,
        message: 'Subscription activated successfully',
        subscription: {
          status: subscription.status,
          plan: subscription.plan,
          endDate: subscription.endDate
        }
      });
    } catch (error) {
      console.error('Error verifying payment:', error);
      res.status(500).json({ message: 'Error verifying payment' });
    }
  }
};

module.exports = subscriptionController;