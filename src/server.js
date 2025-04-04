import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './Routes/authRoutes.js';
import auth from './middleware/auth.js';
import transactionRoutes from './Routes/transactionRoutes.js';
import goalRoutes from './Routes/goalRoutes.js';
import llmRoutes from './Routes/llmRoutes.js'; // Assuming you have a separate route for LLM
// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/goals', auth,goalRoutes); 
app.use('/api/auth', authRoutes);
app.use('/api/transactions', auth,transactionRoutes); 
app.use('/api/llm',auth, llmRoutes); // Assuming you want to use the same route for LLM
// Basic route for testing
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Port
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});