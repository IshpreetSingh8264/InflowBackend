import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';

export const authenticateUser = (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ 
        success: false,
        message: 'No token, authorization denied' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add user from payload
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(StatusCodes.UNAUTHORIZED).json({ 
      success: false,
      message: 'Token is not valid' 
    });
  }
};

// Keep the default export for backward compatibility
const auth = authenticateUser;
export default auth;