import axios from 'axios';
import pool from '../database/db.js';

// Service functions
export const validateWithLLM = async (source, fileName, content) => {
  try {
    const response = await axios.post('http://localhost:11434/validate', {
      source,
      file_name: fileName,
      content
    });
    return response.data;
  } catch (error) {
    console.error(`LLM validation error for ${fileName}:`, error.message);
    return { valid: false, confidence: 0, summary: 'Validation failed' };
  }
};

export const storeResult = async (result) => {
  const { platform, file_name, summary, confidence, validated, user_id } = result;
  const timestamp = result.timestamp || new Date();
  
  const query = `
    INSERT INTO validated_files 
    (platform, file_name, summary, confidence, validated, timestamp, user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;
  
  try {
    const { rows } = await pool.query(query, [
      platform, file_name, summary, 
      confidence, validated, timestamp, user_id
    ]);
    return rows[0];
  } catch (error) {
    console.error('Error storing result:', error);
    throw error;
  }
};

export const formatResultMessage = (results) => {
  if (results.length === 0) return '❌ No valid tax documents found.';
  
  const message = [`✅ Found ${results.length} tax receipt${results.length > 1 ? 's' : ''}:\n`];
  
  results.forEach(result => {
    message.push(`• ${result.platform} – ${result.file_name} (Confidence: ${result.confidence.toFixed(2)})`);
  });
  
  return message.join('\n');
};

// Platform search services
export const searchGmail = async (query, userId) => {
  console.log(`Searching Gmail for "${query}" for user ${userId}`);
  
  // Implementation would use Google API
  // This is a placeholder that would need OAuth setup
  const results = [];
  
  // Placeholder for demo - in reality would fetch from Gmail API
  if (query.toLowerCase().includes('tax')) {
    results.push({
      platform: 'gmail',
      file_name: 'Tax_Receipt_2023.pdf',
      content: 'Base64EncodedPDFContent...',
      timestamp: new Date()
    });
  }
  
  return results;
};

export const searchOneDrive = async (query, userId) => {
  console.log(`Searching OneDrive for "${query}" for user ${userId}`);
  
  const results = [];
  
  // Placeholder for demo
  if (query.toLowerCase().includes('tax')) {
    results.push({
      platform: 'onedrive',
      file_name: 'Income_Tax_Statement.xlsx',
      content: 'Base64EncodedExcelContent...',
      timestamp: new Date()
    });
  }
  
  return results;
};

export const searchTelegram = async (query, userId) => {
  console.log(`Searching Telegram for "${query}" for user ${userId}`);
  
  const results = [];
  
  // Placeholder for demo
  if (query.toLowerCase().includes('tax')) {
    results.push({
      platform: 'telegram',
      file_name: 'Tax_Screenshot.png',
      content: 'Base64EncodedImageContent...',
      timestamp: new Date()
    });
  }
  
  return results;
};

export const searchWhatsApp = async (query, userId) => {
  console.log(`Searching WhatsApp for "${query}" for user ${userId}`);
  
  const results = [];
  
  // Placeholder for demo
  if (query.toLowerCase().includes('tax')) {
    results.push({
      platform: 'whatsapp',
      file_name: 'GST_Invoice.jpg',
      content: 'Base64EncodedImageContent...',
      timestamp: new Date()
    });
  }
  
  return results;
};

export const sendTelegramMessage = async (userId, message) => {
  console.log(`Sending Telegram message to ${userId}: ${message}`);
  
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('Telegram bot token not found');
    return;
  }
  
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: userId,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error sending Telegram message:', error.message);
  }
};

export const sendWhatsAppMessage = async (userId, message) => {
  console.log(`Sending WhatsApp message to ${userId}: ${message}`);
  
  // Meta Business API or Twilio would be used here
  try {
    console.log('WhatsApp message would be sent here through Meta API or Twilio');
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.message);
  }
};

// Database initialization
export const initDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS validated_files (
        id SERIAL PRIMARY KEY,
        platform TEXT,
        file_name TEXT,
        summary TEXT,
        confidence FLOAT,
        validated BOOLEAN,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        user_id TEXT
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
};