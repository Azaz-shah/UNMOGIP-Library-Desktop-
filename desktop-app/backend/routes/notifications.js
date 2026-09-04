import express from 'express';
import NotificationLog from '../models/NotificationLog.js';

const router = express.Router();

// GET /api/notifications - Get all notification logs with filters
router.get('/', async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const query = {};

    if (type) query.type = type;
    if (status) query.status = status;

    const total = await NotificationLog.countDocuments(query);
    const notifications = await NotificationLog.find(query)
      .populate('transaction', 'status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Format response matching Figma design
    const formatted = notifications.map((n) => ({
      _id: n._id,
      date: n.createdAt,
      type: n.type,
      bookTitle: n.bookTitle,
      employeeName: n.employeeName,
      recipients: n.sentTo,
      status: n.status,
      error: n.error,
      subject: n.subject,
      attempts: n.attempts,
    }));

    res.json({
      notifications: formatted,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/notifications/stats - Summary counts
router.get('/stats', async (req, res) => {
  try {
    const [total, sent, failed, queued] = await Promise.all([
      NotificationLog.countDocuments(),
      NotificationLog.countDocuments({ status: 'Sent' }),
      NotificationLog.countDocuments({ status: 'Failed' }),
      NotificationLog.countDocuments({ status: { $in: ['Queued', 'Retrying'] } }),
    ]);

    res.json({ total, sent, failed, queued });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/:id/retry - Retry a failed notification
router.post('/:id/retry', async (req, res) => {
  try {
    const notification = await NotificationLog.findById(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    if (notification.status !== 'Failed') {
      return res.status(400).json({ error: 'Only failed notifications can be retried' });
    }

    // Reset for retry
    notification.status = 'Queued';
    notification.attempts = 0;
    notification.error = '';
    await notification.save();

    res.json({ message: 'Notification queued for retry', notification });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
