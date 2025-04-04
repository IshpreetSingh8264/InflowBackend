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

/**
 * Process transactions through LLM to generate a summary
 * @param {Array} transactions - Array of transaction objects
 * @returns {Object} Summary of transactions
 */
async function generateTransactionSummary(transactions) {
  try {
    // Calculate some basic stats for context
    const totalIncome = transactions
      .filter(t => t.type === 'Income')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    const totalExpenses = transactions
      .filter(t => t.type === 'Expense')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      
    const netAmount = totalIncome - totalExpenses;
    
    // Format transactions for the prompt
    const transactionText = transactions.map(t => 
      `ID: ${t.id}, Title: "${t.title}", Description: "${t.description || 'None'}", Amount: $${t.amount}, Type: ${t.type}, Date: ${new Date(t.created_at).toLocaleDateString()}`
    ).join('\n');
    
    // Create a prompt focused on summary generation
    const prompt = `
You are a personal finance assistant. I need a concise yet insightful summary of my financial transactions for the month.

Here are my transactions:
${transactionText}

Basic stats:
- Total Income: $${totalIncome.toFixed(2)}
- Total Expenses: $${totalExpenses.toFixed(2)}
- Net Amount: $${netAmount.toFixed(2)}

Please provide a summary that includes:
1. A brief overview of my spending and earning patterns
2. Key insights about my largest expenses and income sources
3. Any notable observations or potential areas for improvement
4. A financial health assessment

Format your response as JSON with the following structure:
{
  "summary": "Brief overall summary in 2-3 sentences",
  "insights": [
    "Key insight 1",
    "Key insight 2",
    "Key insight 3"
  ],
  "recommendations": [
    "Recommendation 1",
    "Recommendation 2"
  ],
  "financialHealth": "A brief assessment of financial health"
}

Keep the summary and insights clear, concise, and actionable.
`;

    // Call local Llama model
    const response = await ollama.chat({
      model: 'llama3:latest',
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.3  // Balanced between creativity and consistency
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
    const summaryData = JSON.parse(responseContent);
    
    // Validate that we have required fields
    if (!summaryData.summary) {
      throw new Error('LLM did not return a summary');
    }
    
    return {
      ...summaryData,
      totalIncome,
      totalExpenses,
      netAmount
    };
  } catch (error) {
    console.error('Error generating transaction summary:', error);
    
    // Provide a fallback summary if the LLM fails
    return {
      summary: "Summary could not be generated automatically.",
      insights: [
        "You had a total income of $" + transactions
          .filter(t => t.type === 'Income')
          .reduce((sum, t) => sum + parseFloat(t.amount), 0).toFixed(2),
        "You spent a total of $" + transactions
          .filter(t => t.type === 'Expense')
          .reduce((sum, t) => sum + parseFloat(t.amount), 0).toFixed(2)
      ],
      recommendations: [
        "Please review your transactions manually for insights."
      ],
      financialHealth: "Not available due to error in processing.",
      totalIncome: transactions
        .filter(t => t.type === 'Income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0),
      totalExpenses: transactions
        .filter(t => t.type === 'Expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0),
      netAmount: transactions
        .filter(t => t.type === 'Income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0) - 
        transactions
        .filter(t => t.type === 'Expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0)
    };
  }
}

/**
 * Generate a summary of user transactions for a specific month
 * @route GET /api/transactions/summary
 */
export const summarizeTransactions = async (req, res) => {
  try {
    const uuid = req.user.uuid; // From auth middleware
    
    // Get month and year from request query or use current month
    const { month, year } = req.query;
    const currentDate = new Date();
    const targetMonth = month ? parseInt(month, 10) - 1 : currentDate.getMonth();
    const targetYear = year ? parseInt(year, 10) : currentDate.getFullYear();
    
    // Calculate date range for the month
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0); // Last day of month
    
    // Get user transactions for the specified month
    const query = `
      SELECT id, title, description, amount, type, created_at 
      FROM transactions 
      WHERE uuid = $1 AND created_at >= $2 AND created_at <= $3
      ORDER BY created_at ASC
    `;
    
    const { rows } = await pool.query(query, [
      uuid, 
      startDate.toISOString(), 
      endDate.toISOString()
    ]);
    
    if (rows.length === 0) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'No transactions found for the specified month',
        data: {
          summary: "No transactions recorded for this month.",
          insights: [],
          recommendations: ["Consider tracking all your expenses for better financial insights."],
          financialHealth: "Not available due to lack of data.",
          totalIncome: 0,
          totalExpenses: 0,
          netAmount: 0,
          month: targetMonth + 1,
          year: targetYear
        }
      });
    }

    // Generate transaction summary
    const summaryData = await generateTransactionSummary(rows);

    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Transaction summary generated successfully',
      data: {
        ...summaryData,
        month: targetMonth + 1,
        year: targetYear,
        transactionCount: rows.length
      }
    });
  } catch (error) {
    console.error('Error summarizing transactions:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to generate transaction summary'
    });
  }
};

export default summarizeTransactions;