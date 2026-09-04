import nodemailer from 'nodemailer';

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Send email helper with retry logic (Rule 5: max 3 attempts)
const sendEmail = async ({ to, subject, html }, attempt = 1) => {
  const maxAttempts = 3;
  // Offline desktop app / no SMTP configured: skip quickly instead of timing out
  if (!process.env.SMTP_HOST) {
    console.log(`📧 SMTP not configured — skipping email to ${to}: ${subject}`);
    return false;
  }
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    console.log(`📧 Email sent to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error(`❌ Email failed to ${to} (attempt ${attempt}/${maxAttempts}):`, error.message);
    if (attempt < maxAttempts) {
      // Retry after delay
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      return sendEmail({ to, subject, html }, attempt + 1);
    }
    return false;
  }
};

// Send to multiple recipients
const sendToMultiple = async (recipients, subject, html) => {
  const results = await Promise.allSettled(
    recipients.map(email => sendEmail({ to: email, subject, html }))
  );
  return results;
};

// Borrow confirmation email (Rule 5A)
// Recipients: Employee office email + HR/Admin office email
export const sendBorrowConfirmation = async (employee, book, dueDate, admin = null) => {
  const borrowDuration = parseInt(process.env.BORROW_DURATION_DAYS || '30');
  const html = `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 24px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">📚 Book Issued Successfully</h1>
      </div>
      <div style="padding: 24px; background: #f8fafc;">
        <p style="color: #334155; font-size: 15px;">Dear <strong>${employee.name}</strong>,</p>
        <p style="color: #475569; font-size: 14px;">The following book has been issued to you:</p>
        <div style="background: white; border-radius: 10px; padding: 16px; margin: 16px 0; border: 1px solid #e2e8f0;">
          <p style="margin: 4px 0; color: #475569;"><strong>Employee Name:</strong> ${employee.name}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Employee ID:</strong> ${employee.employeeId || 'N/A'}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Book Title:</strong> ${book.title}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Author:</strong> ${book.author}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Book Barcode:</strong> ${book.barcode || 'N/A'}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Issued By:</strong> ${admin ? admin.name : 'Library Admin'}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Issue Date:</strong> ${new Date().toLocaleDateString()}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Due Date:</strong> ${new Date(dueDate).toLocaleDateString()}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Duration:</strong> ${borrowDuration} days</p>
        </div>
        <p style="color: #64748b; font-size: 13px;">Please return the book before the due date to avoid overdue status.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">UNMOGIP Library Management System</p>
      </div>
    </div>
  `;
  // Send to employee + HR/Admin + issuing admin (Rule 5A)
  const recipients = [employee.email];
  if (admin && admin.email) {
    recipients.push(admin.email);
  }
  if (process.env.HR_EMAIL && process.env.HR_EMAIL !== 'hr@unmogip.org') {
    recipients.push(process.env.HR_EMAIL);
  }
  await sendToMultiple(recipients, `Book Issued: ${book.title}`, html);
};

// Return confirmation email (Rule 5C)
// Recipients: Employee office email + HR/Admin office email
export const sendReturnConfirmation = async (employee, book, dueDate, isReturnedLate = false) => {
  const returnStatus = isReturnedLate ? '⚠️ Returned Late' : '✅ Returned On Time';
  const bgColor = isReturnedLate ? 'linear-gradient(135deg, #d97706, #f59e0b)' : 'linear-gradient(135deg, #16a34a, #22c55e)';

  const html = `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${bgColor}; padding: 24px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">📖 ${returnStatus}</h1>
      </div>
      <div style="padding: 24px; background: #f8fafc;">
        <p style="color: #334155; font-size: 15px;">Dear <strong>${employee.name}</strong>,</p>
        <p style="color: #475569; font-size: 14px;">The following book has been returned:</p>
        <div style="background: white; border-radius: 10px; padding: 16px; margin: 16px 0; border: 1px solid #e2e8f0;">
          <p style="margin: 4px 0; color: #475569;"><strong>Employee Name:</strong> ${employee.name}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Book Title:</strong> ${book.title}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Author:</strong> ${book.author}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Return Date:</strong> ${new Date().toLocaleDateString()}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Original Due Date:</strong> ${dueDate ? new Date(dueDate).toLocaleDateString() : 'N/A'}</p>
          <p style="margin: 4px 0; color: ${isReturnedLate ? '#dc2626' : '#16a34a'};"><strong>Status:</strong> ${returnStatus}</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">UNMOGIP Library Management System</p>
      </div>
    </div>
  `;
  // Send to employee + HR/Admin (Rule 5C)
  const recipients = [employee.email];
  if (process.env.HR_EMAIL && process.env.HR_EMAIL !== 'hr@unmogip.org') {
    recipients.push(process.env.HR_EMAIL);
  }
  await sendToMultiple(recipients, `Book Returned: ${book.title}`, html);
};

// Due date reminder email (Rule 5B)
// Recommended: 1 alert on due date +1, then every 3 days until returned
export const sendDueDateReminder = async (employee, book, dueDate, daysLeft) => {
  const urgency = daysLeft <= 0 ? '🔴 OVERDUE' : daysLeft === 1 ? '🟡 Due Tomorrow' : `📅 Due in ${daysLeft} days`;
  const subject = daysLeft <= 0
    ? `OVERDUE: "${book.title}" is past due`
    : `Reminder: "${book.title}" ${daysLeft === 1 ? 'due tomorrow' : `due in ${daysLeft} days`}`;

  const html = `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${daysLeft <= 0 ? 'linear-gradient(135deg, #dc2626, #ef4444)' : 'linear-gradient(135deg, #d97706, #f59e0b)'}; padding: 24px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">${urgency}</h1>
      </div>
      <div style="padding: 24px; background: #f8fafc;">
        <p style="color: #334155; font-size: 15px;">Dear <strong>${employee.name}</strong>,</p>
        <p style="color: #475569; font-size: 14px;">${daysLeft <= 0 ? 'The following book is overdue. Please return it as soon as possible.' : `This is a reminder that the following book is due ${daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`}.</p>`}
        <div style="background: white; border-radius: 10px; padding: 16px; margin: 16px 0; border: 1px solid #e2e8f0;">
          <p style="margin: 4px 0; color: #475569;"><strong>Book:</strong> ${book.title}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Author:</strong> ${book.author}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Due Date:</strong> ${new Date(dueDate).toLocaleDateString()}</p>
          ${daysLeft < 0 ? `<p style="margin: 4px 0; color: #dc2626;"><strong>Days Overdue:</strong> ${Math.abs(daysLeft)}</p>` : ''}
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">UNMOGIP Library Management System</p>
      </div>
    </div>
  `;

  // Send to employee (Rule 5B)
  await sendEmail({ to: employee.email, subject, html });
  // Send copy to HR/Admin (configurable)
  if (process.env.HR_EMAIL && process.env.HR_EMAIL !== 'hr@unmogip.org') {
    await sendEmail({ to: process.env.HR_EMAIL, subject: `[HR Copy] ${subject}`, html });
  }
};

// New member registration email
export const sendMemberWelcome = async (employee) => {
  const html = `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0891b2, #06b6d4); padding: 24px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">👋 Welcome to UNMOGIP Library</h1>
      </div>
      <div style="padding: 24px; background: #f8fafc;">
        <p style="color: #334155; font-size: 15px;">Dear <strong>${employee.name}</strong>,</p>
        <p style="color: #475569; font-size: 14px;">You have been registered as a library member.</p>
        <div style="background: white; border-radius: 10px; padding: 16px; margin: 16px 0; border: 1px solid #e2e8f0;">
          <p style="margin: 4px 0; color: #475569;"><strong>Employee ID:</strong> ${employee.employeeId}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Barcode:</strong> ${employee.barcode}</p>
          <p style="margin: 4px 0; color: #475569;"><strong>Department:</strong> ${employee.department || 'N/A'}</p>
        </div>
        <p style="color: #64748b; font-size: 13px;">You can now borrow books by scanning your employee barcode at the library desk.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">UNMOGIP Library Management System</p>
      </div>
    </div>
  `;
  await sendEmail({ to: employee.email, subject: 'Welcome to UNMOGIP Library', html });
};

export default sendEmail;
