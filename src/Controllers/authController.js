import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../database/db.js';

const authController = {
  // Register a new user
  register: async (req, res) => {
    try {
      const { username, email, password } = req.body;

      // Check if user already exists
      const userExists = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (userExists.rows.length > 0) {
        return res.status(400).json({ message: 'User already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Generate UUID
      const userUuid = uuidv4();

      // Insert user into database
      const newUser = await pool.query(
        'INSERT INTO users (uuid, username, email, password) VALUES ($1, $2, $3, $4) RETURNING uuid, username, email',
        [userUuid, username, email, hashedPassword]
      );

      // Generate JWT token
      const token = jwt.sign(
        { uuid: newUser.rows[0].uuid },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          uuid: newUser.rows[0].uuid,
          username: newUser.rows[0].username,
          email: newUser.rows[0].email
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  },

  // Login user
  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      // Check if user exists
      const user = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (user.rows.length === 0) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Validate password
      const isValidPassword = await bcrypt.compare(password, user.rows[0].password);

      if (!isValidPassword) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { uuid: user.rows[0].uuid },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(200).json({
        message: 'Login successful',
        token,
        user: {
          uuid: user.rows[0].uuid,
          username: user.rows[0].username,
          email: user.rows[0].email
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  },

  // Get current user profile
  getProfile: async (req, res) => {
    try {
      const user = await pool.query(
        'SELECT uuid, username, email FROM users WHERE uuid = $1',
        [req.user.uuid]
      );

      if (user.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.status(200).json({
        user: user.rows[0]
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
};

export default authController;