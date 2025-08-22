import { StatusCodes } from 'http-status-codes';
import * as n8nService from './n8n.js';

// Initialize database on module load
n8nService.initDatabase();

/**
 * Search across multiple platforms for documents
 * @route POST /api/n8n/search
 */
export const searchDocuments = async (req, res) => {
  const { query, userId } = req.body;
  
  if (!query || !userId) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: 'Missing required parameters: query and userId'
    });
  }
  
  try {
    // 1. Search across all platforms in parallel
    const [gmailResults, onedriveResults, telegramResults, whatsappResults] = await Promise.allSettled([
      n8nService.searchGmail(query, userId),
      n8nService.searchOneDrive(query, userId),
      n8nService.searchTelegram(query, userId),
      n8nService.searchWhatsApp(query, userId)
    ]);
    
    // 2. Process and validate all search results
    const allResults = [];
    const processingPromises = [];
    
    // Process results from each platform
    const processResults = (platform, results) => {
      if (results.status === 'fulfilled' && Array.isArray(results.value)) {
        for (const item of results.value) {
          processingPromises.push(
            n8nService.validateWithLLM(item.platform, item.file_name, item.content)
              .then(validation => {
                const result = {
                  platform: item.platform,
                  file_name: item.file_name,
                  summary: validation.summary,
                  confidence: validation.confidence,
                  validated: validation.valid,
                  timestamp: item.timestamp,
                  user_id: userId
                };
                
                allResults.push(result);
                return n8nService.storeResult(result);
              })
          );
        }
      }
    };
    
    processResults('gmail', gmailResults);
    processResults('onedrive', onedriveResults);
    processResults('telegram', telegramResults);
    processResults('whatsapp', whatsappResults);
    
    // Wait for all validation and storage to complete
    await Promise.all(processingPromises);
    
    // 3. Filter for valid results with confidence >= 0.8
    const validatedResults = allResults.filter(result => 
      result.validated === true && result.confidence >= 0.8
    );
    
    // 4. Format message for user
    const resultMessage = n8nService.formatResultMessage(validatedResults);
    
    // 5. Send message to user on appropriate platform (based on userId format)
    const isWhatsApp = userId.startsWith('+');
    if (isWhatsApp) {
      await n8nService.sendWhatsAppMessage(userId, resultMessage);
    } else {
      await n8nService.sendTelegramMessage(userId, resultMessage);
    }
    
    // 6. Return success response
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Search completed successfully',
      results: {
        totalFound: allResults.length,
        validatedCount: validatedResults.length,
        sentMessage: resultMessage
      }
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to process search request',
      error: error.message
    });
  }
};