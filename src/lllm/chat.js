import { Ollama } from 'ollama';
import { StatusCodes } from 'http-status-codes';
import pool from '../database/db.js';

// Initialize Ollama
const ollama = new Ollama({ host: 'http://localhost:11434' });

// In-memory storage for active chat sessions
// For production, consider using Redis or a database
const chatSessions = new Map();

// Session timeout (30 minutes in ms)
const SESSION_TIMEOUT = 30 * 60 * 1000; 

/**
 * Initialize or retrieve a chat session 
 * @param {string} uuid - User UUID
 * @param {Array} transactions - User transactions (optional)
 * @param {Object} financialGoals - User financial goals (optional)
 * @returns {Object} Chat session object
 */
async function getOrCreateChatSession(uuid, transactions = null, financialGoals = null) {
  // Check if there's an existing session
  if (chatSessions.has(uuid)) {
    const session = chatSessions.get(uuid);
    // Update last accessed time
    session.lastAccessed = Date.now();
    
    // If new data is provided, update the session
    if (transactions) session.transactions = transactions;
    if (financialGoals) session.financialGoals = financialGoals;
    
    return session;
  }
  
  // Create a new session
  const session = {
    uuid,
    messages: [],
    transactions: transactions || [],
    financialGoals: financialGoals || {},
    lastAccessed: Date.now()
  };
  
  chatSessions.set(uuid, session);
  return session;
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [uuid, session] of chatSessions.entries()) {
    if (now - session.lastAccessed > SESSION_TIMEOUT) {
      chatSessions.delete(uuid);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

/**
 * Format transactions for chat context
 * @param {Array} transactions - User transactions
 * @returns {string} Formatted transaction text
 */
function formatTransactionsForContext(transactions) {
  if (!transactions || transactions.length === 0) return "No transactions available.";
  
  return transactions.map(t => 
    `ID: ${t.id}, Title: "${t.title}", Description: "${t.description || 'None'}", Amount: $${t.amount}, Type: ${t.type}, Date: ${new Date(t.created_at).toLocaleDateString()}`
  ).join('\n');
}

/**
 * Format financial goals for chat context
 * @param {Object} goals - User financial goals
 * @returns {string} Formatted goals text
 */
function formatGoalsForContext(goals) {
  if (!goals || Object.keys(goals).length === 0) return "No financial goals set.";
  
  return Object.entries(goals).map(([key, value]) => 
    `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`
  ).join('\n');
}

/**
 * Create system prompt based on user data
 * @param {Array} transactions - User transactions
 * @param {Object} goals - User financial goals
 * @returns {string} System prompt
 */
function createSystemPrompt(transactions, goals) {
  return `You are a helpful financial assistant who provides guidance based on the user's transaction history and financial goals.

TRANSACTION HISTORY:
${formatTransactionsForContext(transactions)}

FINANCIAL GOALS:
${formatGoalsForContext(goals)}

INSTRUCTIONS:
1. Provide personalized financial advice based on the transaction data and goals
2. Be conversational but professional
3. Offer actionable insights when possible
4. Only discuss the user's own financial data
5. Keep responses concise and focused on financial matters
6. If asked about transactions or spending patterns, reference the specific data
7. When suggesting strategies, align them with the user's stated goals

When the user asks follow-up questions, remember previous parts of the conversation to provide consistent advice.`;
}

/**
 * Initialize a chat session with user's financial data
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const initializeChat = async (req, res) => {
  try {
    const uuid = req.user.uuid; // From auth middleware
    
    // Get user transactions
    const transactionQuery = 'SELECT id, title, description, amount, type, created_at FROM transactions WHERE uuid = $1';
    const { rows: transactions } = await pool.query(transactionQuery, [uuid]);
    
    // Get user financial goals (assuming a goals table exists)
    // If you don't have a goals table, adjust accordingly
    const goalQuery = 'SELECT * FROM financial_goals WHERE uuid = $1';
    const { rows: goalRows } = await pool.query(goalQuery, [uuid]).catch(() => ({ rows: [] }));
    
    // Format goals into a more usable object
    const goals = goalRows.reduce((acc, goal) => {
      acc[goal.goal_type] = {
        target: goal.target_amount,
        timeline: goal.timeline,
        priority: goal.priority
      };
      return acc;
    }, {});
    
    // Create or update chat session
    const session = await getOrCreateChatSession(uuid, transactions, goals);
    
    // Add system message to the session
    if (session.messages.length === 0) {
      const systemPrompt = createSystemPrompt(transactions, goals);
      session.messages.push({
        role: 'system',
        content: systemPrompt
      });
      
      // Add welcome message
      session.messages.push({
        role: 'assistant',
        content: `Hello! I'm your financial assistant. I can help you understand your spending patterns, track your progress toward financial goals, or answer questions about your finances. How can I help you today?`
      });
    }
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Chat session initialized',
      data: {
        chatHistory: session.messages.filter(msg => msg.role !== 'system') // Don't expose system prompt to frontend
      }
    });
    
  } catch (error) {
    console.error('Error initializing chat:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to initialize chat session'
    });
  }
};

/**
 * Send a message and get a response
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const sendMessage = async (req, res) => {
  try {
    const uuid = req.user.uuid; // From auth middleware
    const { message } = req.body;
    
    if (!message) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Message content is required'
      });
    }
    
    // Get or create chat session
    const session = await getOrCreateChatSession(uuid);
    
    // Add user message to history
    session.messages.push({
      role: 'user',
      content: message
    });
    
    // Prepare the messages for Ollama
    // We use all messages including system prompt
    const ollamaMessages = session.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    // Get response from Ollama
    const response = await ollama.chat({
      model: 'llama3:latest',
      messages: ollamaMessages,
      options: {
        temperature: 0.7, // More creative for chat
        num_ctx: 8192    // Large context to hold conversation history
      }
    });
    
    // Add assistant response to history
    const assistantMessage = {
      role: 'assistant',
      content: response.message.content
    };
    
    session.messages.push(assistantMessage);
    
    // Prune history if it gets too long (keep last 20 messages excluding system prompt)
    if (session.messages.length > 21) { // 1 system + 20 conversation messages
      const systemPrompt = session.messages[0]; // Keep system prompt
      session.messages = [systemPrompt, ...session.messages.slice(-20)];
    }
    
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        message: assistantMessage,
        chatHistory: session.messages.filter(msg => msg.role !== 'system') // Don't expose system prompt
      }
    });
    
  } catch (error) {
    console.error('Error in chat:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to process message'
    });
  }
};

/**
 * Get chat history for the user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const getChatHistory = async (req, res) => {
  try {
    const uuid = req.user.uuid;
    
    // Get chat session
    const session = chatSessions.get(uuid);
    
    if (!session) {
      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          chatHistory: []
        }
      });
    }
    
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        chatHistory: session.messages.filter(msg => msg.role !== 'system') // Don't expose system prompt
      }
    });
    
  } catch (error) {
    console.error('Error getting chat history:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to retrieve chat history'
    });
  }
};

/**
 * Clear chat history for the user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const clearChatHistory = async (req, res) => {
  try {
    const uuid = req.user.uuid;
    
    // Remove the session
    chatSessions.delete(uuid);
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Chat history cleared'
    });
    
  } catch (error) {
    console.error('Error clearing chat history:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to clear chat history'
    });
  }
};

export default {
  initializeChat,
  sendMessage,
  getChatHistory,
  clearChatHistory
};