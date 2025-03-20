// billController.js
const Bill = require('../models/billModel');
const Table = require('../models/tableModel');
const HoldBill = require('../models/holdBillModel');
const Counter = require('../models/counterModel');

// Utility function to validate and parse date
const parseDate = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
};

// Function to get next sequence
const getNextSequence = async (restaurantId) => {
  const counter = await Counter.findOneAndUpdate(
    { restaurantId, name: 'billNumber' },
    { $inc: { seq: 1 } },
    { 
      new: true,
      upsert: true
    }
  );
  return counter.seq;
};

// Get all bills with pagination and filters
exports.getBills = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      startDate,
      endDate,
      paymentStatus,
      minAmount,
      maxAmount
    } = req.query;

    const query = {
      restaurantId: req.user.restaurantId
    };

    // Apply filters if provided
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    // Handle date filtering with validation
    const parsedStartDate = parseDate(startDate);
    const parsedEndDate = parseDate(endDate);
    
    if (parsedStartDate || parsedEndDate) {
      query.createdAt = {};
      if (parsedStartDate) query.createdAt.$gte = parsedStartDate;
      if (parsedEndDate) {
        parsedEndDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = parsedEndDate;
      }
    }

    // Handle amount filtering
    if (minAmount || maxAmount) {
      query.totalAmount = {};
      if (minAmount && !isNaN(minAmount)) query.totalAmount.$gte = Number(minAmount);
      if (maxAmount && !isNaN(maxAmount)) query.totalAmount.$lte = Number(maxAmount);
    }

    const options = {
      sort: { createdAt: -1 },
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    };

    const [bills, total] = await Promise.all([
      Bill.find(query, null, options),
      Bill.countDocuments(query)
    ]);

    res.json({
      bills,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Error in getBills:', error);
    res.status(500).json({ 
      message: 'Failed to fetch bills',
      error: error.message 
    });
  }
};

// Get single bill by ID
exports.getBillById = async (req, res) => {
  try {
    const bill = await Bill.findOne({
      _id: req.params.id,
      restaurantId: req.user.restaurantId
    });

    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    res.json(bill);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get active bill for a table
exports.getTableActiveBill = async (req, res) => {
  try {
    const bill = await Bill.findOne({
      tableId: req.params.tableId,
      restaurantId: req.user.restaurantId,
      status: 'ACTIVE'
    });

    if (!bill) {
      return res.status(404).json({ message: 'No active bill found for this table' });
    }

    res.json(bill);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// In billController.js
exports.getBillsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Validate date parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        message: 'Both startDate and endDate are required'
      });
    }

    // Parse and validate dates
    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);

    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({
        message: 'Invalid date format. Please use ISO format'
      });
    }

    // Ensure end date includes the full day
    parsedEndDate.setHours(23, 59, 59, 999);

    // Add query timeout
    const queryOptions = { maxTimeMS: 10000 }; // 10 second timeout

    const [billsSummary, paymentSummary] = await Promise.all([
      Bill.aggregate([
        {
          $match: {
            restaurantId: req.user.restaurantId,
            createdAt: {
              $gte: parsedStartDate,
              $lte: parsedEndDate
            }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' },
            averageAmount: { $avg: '$totalAmount' }
          }
        }
      ], queryOptions),

      Bill.aggregate([
        {
          $match: {
            restaurantId: req.user.restaurantId,
            status: 'COMPLETED',
            createdAt: {
              $gte: parsedStartDate,
              $lte: parsedEndDate
            }
          }
        },
        {
          $group: {
            _id: '$paymentMethod',
            count: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' }
          }
        }
      ], queryOptions)
    ]);

    // Validate aggregation results
    if (!Array.isArray(billsSummary) || !Array.isArray(paymentSummary)) {
      throw new Error('Invalid aggregation result format');
    }

    res.json({
      billsSummary,
      paymentSummary,
      dateRange: {
        start: parsedStartDate,
        end: parsedEndDate
      }
    });
  } catch (error) {
    console.error('Error in getBillsSummary:', error);
    res.status(error.status || 500).json({ 
      message: 'Failed to fetch bills summary',
      error: error.message,
      code: error.code
    });
  }
};

// Save bill
exports.saveBill = async (req, res) => {
  try {
    const { tableId } = req.params;
    
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ message: 'Table not found' });
    }
    
    const holdBills = await HoldBill.find({
      tableId,
      restaurantId: req.user.restaurantId,
      status: 'HOLD'
    });

    if (!holdBills || holdBills.length === 0) {
      return res.status(404).json({ message: 'No hold bills found for this table' });
    }

    // Calculate totals from all hold bills
    const allItems = holdBills.reduce((acc, bill) => [...acc, ...bill.items], []);
    const subtotal = holdBills.reduce((sum, bill) => sum + bill.subtotal, 0);
    const cgst = holdBills.reduce((sum, bill) => sum + bill.cgst, 0);
    const sgst = holdBills.reduce((sum, bill) => sum + bill.sgst, 0);
    
    // Use the discount percentage and payment mode from the first hold bill
    const discountPercentage = holdBills[0].discountPercentage || 0;
    const paymentMethod = holdBills[0].paymentMode.toUpperCase(); // Convert to match Bill model enum
    
    // Calculate total before discount
    const totalBeforeDiscount = subtotal + cgst + sgst;
    
    // Calculate discount amount
    const discountAmount = (totalBeforeDiscount * discountPercentage) / 100;
    
    // Calculate final total
    const totalAmount = totalBeforeDiscount - discountAmount;

    // Get next bill number
    const billNumber = await getNextSequence(req.user.restaurantId);

    const newBill = new Bill({
      billNumber,
      tableId,
      tableNumber: table.tableNumber,
      restaurantId: req.user.restaurantId,
      items: allItems,
      subtotal,
      cgst,
      sgst,
      discountPercentage,
      discountAmount,
      totalAmount,
      status: 'COMPLETED',
      paymentMethod, // Add the payment method from hold bill
      paymentStatus: 'PAID', // Set appropriate payment status
      names: holdBills.map(bill => bill.names).filter(Boolean).join(' | ')
    });

    await newBill.save();

    // Update hold bills status
    await HoldBill.updateMany(
      {
        _id: { $in: holdBills.map(bill => bill._id) }
      },
      { status: 'RESUMED' }
    );

    // Update table status
    await Table.findByIdAndUpdate(tableId, { status: 'Available' });

    res.json(newBill);
  } catch (error) {
    console.error('Error in saveBill:', error);
    res.status(500).json({ 
      message: 'Failed to save bill',
      error: error.message 
    });
  }
};

exports.updateBill = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Validate bill exists and belongs to restaurant
    const bill = await Bill.findOne({
      _id: id,
      restaurantId: req.user.restaurantId
    });

    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    // Calculate new totals if items are being updated
    if (updates.items) {
      let subtotal = 0;
      updates.items.forEach(item => {
        subtotal += item.price * item.quantity;
      });

      // Calculate taxes (assuming 5% each for CGST and SGST)
      const cgst = subtotal * 0.05;
      const sgst = subtotal * 0.05;

      // Calculate discount if applicable
      const discountAmount = bill.discountPercentage ? 
        (subtotal + cgst + sgst) * (bill.discountPercentage / 100) : 0;

      // Update totals
      updates.subtotal = subtotal;
      updates.cgst = cgst;
      updates.sgst = sgst;
      updates.totalAmount = subtotal + cgst + sgst - discountAmount;
    }

    // Update payment related fields if provided
    if (updates.paymentMethod) {
      updates.paymentStatus = 'PAID';
      updates.status = 'COMPLETED';
    }

    const updatedBill = await Bill.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.json(updatedBill);
  } catch (error) {
    console.error('Error in updateBill:', error);
    res.status(500).json({ 
      message: 'Failed to update bill',
      error: error.message 
    });
  }
};

exports.updatePaymentMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod } = req.body;

    if (!['CASH', 'CARD', 'UPI', 'OTHER'].includes(paymentMethod)) {
      return res.status(400).json({ 
        message: 'Invalid payment method' 
      });
    }

    const bill = await Bill.findOneAndUpdate(
      {
        _id: id,
        restaurantId: req.user.restaurantId
      },
      {
        $set: {
          paymentMethod,
          paymentStatus: 'PAID',
          status: 'COMPLETED'
        }
      },
      { new: true, runValidators: true }
    );

    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    res.json(bill);
  } catch (error) {
    console.error('Error in updatePaymentMethod:', error);
    res.status(500).json({ 
      message: 'Failed to update payment method',
      error: error.message 
    });
  }
};