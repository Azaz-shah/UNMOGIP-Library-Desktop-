import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Fallback secret so the desktop app works offline without a .env file.
// Tokens are only ever used locally inside the app.
const getSecret = () => process.env.JWT_SECRET || 'unmogip-library-local-secret-change-me';

// Protect routes - require authentication
export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authorized - no token' });
  }

  try {
    const decoded = jwt.verify(token, getSecret());
    req.user = await User.findById(decoded.id);
    if (!req.user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Not authorized - invalid token' });
  }
};

// Role-based access control
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized for this action' });
    }
    next();
  };
};

// Generate JWT token
export const generateToken = (userId) => {
  return jwt.sign({ id: userId }, getSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};
