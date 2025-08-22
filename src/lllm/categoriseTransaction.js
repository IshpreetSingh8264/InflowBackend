import { Ollama } from 'ollama';
import { StatusCodes } from 'http-status-codes';
import pool from '../database/db.js';
import { v4 as uuidv4 } from 'uuid'; // Add this import for generating unique session IDs

// Initialize Ollama with timeout configuration
const ollama = new Ollama({ 
  host: 'http://localhost:11434', // Default Ollama port
  timeout: 10000 // Set a 10-second timeout for requests
});

// Required minimum number of categories
const MIN_CATEGORIES = 6;

// Required specific categories (must have at least these)
const REQUIRED_SPECIFIC_CATEGORIES = [
    'Personal', 
    'Home expenses', 
    'Education', 
    'Leisure_Entertainment', 
    'Investments_Assets', 
    'Miscellaneous'
  ];

/**
 * Validate and clean JSON response from LLM
 * @param {string} responseContent - Raw response content from LLM
 * @returns {string} Cleaned JSON string
 */
function cleanAndValidateJSON(responseContent) {
  try {
    // Log the raw response for debugging
    console.debug('Raw LLM response:', responseContent);

    // Remove dollar signs
    responseContent = responseContent.replace(/\$\s?/g, '');

    // Handle various ways the LLM might format the JSON
    if (responseContent.startsWith('```json')) {
      responseContent = responseContent.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (responseContent.startsWith('```')) {
      responseContent = responseContent.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    // Extract JSON part if there's additional text
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      responseContent = jsonMatch[0];
    }

    // Detect and fix invalid expressions in the JSON
    responseContent = responseContent.replace(/:\s*([\d.]+\s*\+\s*[\d.]+)\s*=\s*[\d.]+/g, (match, expression) => {
      // Evaluate the expression and replace it with the result
      try {
        const result = eval(expression); // Use eval cautiously, only for controlled input
        return `: ${result}`;
      } catch {
        throw new Error(`Invalid expression in JSON: ${expression}`);
      }
    });

    // Ensure the JSON is valid
    JSON.parse(responseContent); // This will throw an error if invalid

    return responseContent;
  } catch (error) {
    console.error('Error cleaning and validating JSON:', error.message);
    console.debug('Sanitized response content:', responseContent);
    throw new Error('Invalid JSON format in LLM response');
  }
}

/**
 * Retry helper function for async operations
 * @param {Function} fn - The async function to retry
 * @param {number} retries - Number of retry attempts
 * @param {number} delay - Delay between retries in milliseconds
 */
async function retryAsync(fn, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Process transactions through LLM to categorize them
 * @param {Array} transactions - Array of transaction objects
 * @returns {Object} Categorized transaction data
 */
async function processTransactionsWithLLM(transactions) {
  try {
    // Format transactions for the prompt with more emphasis on descriptions
    const transactionText = transactions.map(t => 
      `ID: ${t.id}, Title: "${t.title}", Description: "${t.description || 'None'}", Amount: ${t.amount}, Type: ${t.type}`
    ).join('\n');
    
    // Enhanced prompt with very explicit instructions and forced categorization
    const prompt = `
You are a financial categorization AI.

Your job is to analyze the following financial transactions and categorize each into ONE of the following EXACT SIX categories:

1. Personal
2. Home expenses
3. Education
4. Leisure & Entertainment
5. Investments & Assets
6. Miscellaneous

You MUST NOT invent or hallucinate any data. Use ONLY the transactions provided. For each category, sum the amounts of all transactions that belong in that category.

💡 You are NOT responsible for calculating percentages — just return total amounts grouped by category.

Format your response EXACTLY as this JSON:

{
  "categories": [
    { "name": "Personal", "amount": <number> },
    { "name": "Home expenses", "amount": <number> },
    { "name": "Education", "amount": <number> },
    { "name": "Leisure & Entertainment", "amount": <number> },
    { "name": "Investments & Assets", "amount": <number> },
    { "name": "Miscellaneous", "amount": <number> }
  ]
}

Here are the transactions:
${transactionText}
`;

    // Retry the Ollama API call with retry logic
    const response = await retryAsync(() => ollama.chat({
      model: 'llama3:latest',
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.1,
        session_id: uuidv4() // Generate a new session ID for every request
      }
    }));

    // Sanitize and validate LLM response
    let responseContent = response.message.content.trim();
    responseContent = cleanAndValidateJSON(responseContent);

    // Parse and validate the response
    const categorizedData = JSON.parse(responseContent);
    
    // Validate that we have categories
    if (!categorizedData.categories || categorizedData.categories.length === 0) {
      throw new Error('LLM did not return any categories');
    }
    
    // Verify we have all required categories
    const returnedCategories = new Set(categorizedData.categories.map(c => c.name));
    const missingCategories = REQUIRED_SPECIFIC_CATEGORIES.filter(c => !returnedCategories.has(c));
    
    if (missingCategories.length > 0) {
      // Add missing categories with zero values
      missingCategories.forEach(categoryName => {
        categorizedData.categories.push({
          name: categoryName,
          amount: 0,
          percentage: 0
        });
      });
    }
    
    return categorizedData;
  } catch (error) {
    if (error.code === 'UND_ERR_CONNECT_TIMEOUT') {
      console.error('Connection to Ollama service timed out:', error.message);
    } else if (error.message.includes('fetch failed')) {
      console.error('Failed to fetch response from Ollama service:', error.message);
    } else {
      console.error('Error processing transactions with LLM:', error.message);
    }
    
    // Fall back to using our required categories
    const totalAmount = transactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    return {
      categories: REQUIRED_SPECIFIC_CATEGORIES.map(name => ({
        name,
        amount: name === 'Uncategorized' ? totalAmount : 0,
        percentage: name === 'Uncategorized' ? 100 : 0
      }))
    };
  }
}

/**
 * Categorize transactions for a user
 * @route GET /api/transactions/categories
 */
export const categorizeTransactions = async (req, res) => {
  try {
    const uuid = req.user.uuid; // From auth middleware
    
    // Get all user transactions with type information
    const query = 'SELECT id, title, description, amount, type FROM transactions WHERE uuid = $1 ';
    const { rows } = await pool.query(query, [uuid]);
    
    if (rows.length === 0) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'No transactions to categorize',
        data: {
          categories: REQUIRED_SPECIFIC_CATEGORIES.map(name => ({
            name,
            amount: 0,
            percentage: 0
          }))
        }
      });
    }

    // Process transactions to get categorized data
    const categorizedData = await processTransactionsWithLLM(rows);

    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Transactions categorized successfully',
      data: categorizedData
    });
  } catch (error) {
    console.error('Error categorizing transactions:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to categorize transactions'
    });
  }
};

export default categorizeTransactions;