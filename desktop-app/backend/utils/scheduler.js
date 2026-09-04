import cron from 'node-cron';
import Borrowing from '../models/Borrowing.js';
import NotificationLog from '../models/NotificationLog.js';
import { sendDueDateReminder } from './email.js';

// Run daily at 8:00 AM
const scheduleDueDateChecks = () => {
  cron.schedule('0 8 * * *', async () => {
    console.log(' Running daily due-date check...');
    try {
      const now = new Date();

      // Find all active borrowings
      const activeBorrowings = await Borrowing.find({ status: { $in: ['borrowed', 'overdue'] } })
        .populate('book')
        .populate('employee');

      let remindersSent = 0;

      for (const borrowing of activeBorrowings) {
        if (!borrowing.book || !borrowing.employee) continue;

        const dueDate = new Date(borrowing.dueDate);
        const diffTime = dueDate - now;
        const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Rule 5B: 1 day before due date reminder
        if (daysLeft === 1 && !borrowing.notificationsSent.reminder1Day) {
          await sendDueDateReminder(borrowing.employee, borrowing.book, dueDate, 1);
          borrowing.notificationsSent.reminder1Day = true;
          await borrowing.save();
          remindersSent++;
        }

        // Rule 5B: On due date reminder
        if (daysLeft === 0 && !borrowing.notificationsSent.reminderDueDate) {
          await sendDueDateReminder(borrowing.employee, borrowing.book, dueDate, 0);
          borrowing.notificationsSent.reminderDueDate = true;
          borrowing.status = 'overdue';
          await borrowing.save();
          remindersSent++;
        }

        // Rule 5B: Overdue - every 3 days until returned
        if (daysLeft < 0) {
          // Update status to overdue
          if (borrowing.status !== 'overdue') {
            borrowing.status = 'overdue';
            await borrowing.save();
          }

          // Send overdue alert: on day +1, then every 3 days
          const daysOverdue = Math.abs(daysLeft);
          const shouldSendOverdue =
            daysOverdue === 1 || // First overdue day
            (daysOverdue > 1 && daysOverdue % 3 === 0); // Every 3 days after

          if (shouldSendOverdue) {
            await sendDueDateReminder(borrowing.employee, borrowing.book, dueDate, daysLeft);
            borrowing.notificationsSent.overdueAlert = true;
            await borrowing.save();
            remindersSent++;
          }
        }
      }

      console.log(` Due-date check complete. ${remindersSent} reminders sent.`);
    } catch (error) {
      console.error(' Due-date check error:', error.message);
    }
  });
};

export default scheduleDueDateChecks;
