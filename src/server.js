import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './Routes/authRoutes.js';
import auth from './middleware/auth.js';
import transactionRoutes from './Routes/transactionRoutes.js';
import goalRoutes from './Routes/goalRoutes.js';
import llmRoutes from './Routes/llmRoutes.js'; // Assuming you have a separate route for LLM
import chatRoutes from './Routes/chatRoutes.js'; 
import n8nRoutes from './Routes/n8nRoutes.js' // Assuming you have a separate route for chat
import { spawn } from 'child_process'; // Import child_process for Python script execution

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
app.use('/api/chat',auth,chatRoutes)
app.use('/api/n8n', auth, n8nRoutes); // Add n8n routes with auth middleware

// Route for model prediction
app.post('/api/predict', (req, res) => {
  const { ticker, start_date } = req.body;

  // Validate inputs
  if (!ticker || !start_date) {
    return res.status(400).json({ error: 'Ticker and start_date are required' });
  }

  // Call Python script
  const pythonProcess = spawn('python', ['./src/predict.py', ticker, start_date]);

  let result = '';
  let errorOccurred = false;

  pythonProcess.stdout.on('data', (data) => {
    result += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Error: ${data}`);
    errorOccurred = true;
    result = { error: 'Internal server error' };
  });

  pythonProcess.on('close', (code) => {
    if (errorOccurred || code !== 0) {
      return res.status(500).json(result);
    }

    try {
      const prediction = JSON.parse(result);
      res.json(prediction);
    } catch (err) {
      res.status(500).json({ error: 'Failed to parse prediction result' });
    }
  });
});

// Basic route for testing
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Port
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});