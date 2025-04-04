import { Ollama } from 'ollama';
import { StatusCodes } from 'http-status-codes';
import pool from '../database/db.js';

// Initialize Ollama
const ollama = new Ollama({ host: 'http://localhost:11434' }); // Default Ollama port

// Required minimum number of categories
const MIN_CATEGORIES = 6;

// Required specific categories (must have at least these)
const REQUIRED_SPECIFIC_CATEGORIES = [
  'Essentials', 
  'Leisure & Entertainment', 
  'Savings & Investments', 
  'Debt & Loans', 
  'Personal & Shopping', 
  'Uncategorized'
];

/**
 * Process transactions through LLM to categorize them
 * @param {Array} transactions - Array of transaction objects
 * @returns {Object} Categorized transaction data
 */
async function processTransactionsWithLLM(transactions) {
  try {
    // Format transactions for the prompt with more emphasis on descriptions
    const transactionText = transactions.map(t => 
      `ID: ${t.id}, Title: "${t.title}", Description: "${t.description || 'None'}", Amount: $${t.amount}, Type: ${t.type}`
    ).join('\n');
    
    // Enhanced prompt with very explicit instructions and forced categorization
    const prompt = `
You are a financial analysis AI. I need you to categorize these financial transactions into EXACTLY the following 6 categories:
1. Essentials (e.g., rent, groceries, utilities, basic needs)
2. Leisure & Entertainment (e.g., dining out, movies, subscriptions, hobbies)
3. Savings & Investments (e.g., deposits to savings accounts, stocks, retirement contributions)
4. Debt & Loans (e.g., credit card payments, mortgage payments, loan repayments)
5. Personal & Shopping (e.g., clothes, gadgets, personal care, non-essential shopping)
6. Uncategorized (anything that doesn't clearly fit the above categories)

Your task:
1. Carefully analyze each transaction's title and description
2. Sort EVERY transaction into one of the above 6 categories - DO NOT create new categories
3. Calculate the total amount and percentage for each category

IMPORTANT:
- You MUST use ONLY the 6 categories listed above, no more and no less
- Analyze the transaction details carefully to make intelligent categorization decisions
- Make sure both income and expense transactions are appropriately categorized

Here are the transactions to categorize:
${transactionText}

Format your response EXACTLY as follows (JSON format, no explanations):
{
  "categories": [
    {
      "name": "Essentials",
      "amount": total amount in dollars,
      "percentage": percentage as a number (e.g., 25.5 for 25.5%)
    },
    {
      "name": "Leisure & Entertainment",
      "amount": total amount in dollars,
      "percentage": percentage as a number
    },
    ...and so on for all 6 categories...
  ]
}

Every category MUST be included in your response, even if the amount is 0.
`;

    // Call local Llama model with lower temperature for more consistent categorization
    const response = await ollama.chat({
      model: 'llama3:latest',
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.1  // Lower temperature for more consistent results
      }
    });

    // Extract response content
    let responseContent = response.message.content.trim();
    
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
    console.error('Error processing transactions with LLM:', error);
    
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
    const query = 'SELECT id, title, description, amount, type FROM transactions WHERE uuid = $1';
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