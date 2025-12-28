// Firebase Cleanup Utility for corrupted documents
// 🔍 SHERLOCK HOLMES solution for Firestore corruption

import { db } from './database';

export async function cleanupCorruptedVisions(userId: string): Promise<number> {
  try {
    console.log('🔍 SHERLOCK: Starting cleanup of corrupted visions...');
    
    const visionBoards = await db.getVisionBoards(userId);
    let cleaned = 0;
    
    for (const board of visionBoards) {
      try {
        const visionItems = await db.getVisionItems(board.id);
        
        for (const item of visionItems) {
          let shouldDelete = false;
          
          // Check for corruption signs
          if (!item.text) {
            console.log(`🔍 SHERLOCK: Found item with empty text: ${item.id}`);
            shouldDelete = true;
          } else if (item.text.length > 2000000) { // 2MB limit
            console.log(`🔍 SHERLOCK: Found oversized item: ${item.id} (${(item.text.length / 1024 / 1024).toFixed(2)}MB)`);
            shouldDelete = true;
          } else if (item.text.includes('INDEXEDDB_ID:') && item.text.length > 10000) {
            // IndexedDB references should be small
            console.log(`🔍 SHERLOCK: Found bloated IndexedDB reference: ${item.id}`);
            shouldDelete = true;
          }
          
          if (shouldDelete) {
            try {
              await db.deleteVisionItem(item.id);
              console.log(`🔍 SHERLOCK: Deleted corrupted vision: ${item.id}`);
              cleaned++;
            } catch (error) {
              console.error(`🔍 SHERLOCK: Failed to delete ${item.id}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`🔍 SHERLOCK: Error processing board ${board.id}:`, error);
      }
    }
    
    console.log(`🔍 SHERLOCK: Cleanup completed. Removed ${cleaned} corrupted items.`);
    return cleaned;
    
  } catch (error) {
    console.error('🔍 SHERLOCK: Cleanup failed:', error);
    return 0;
  }
}

export async function validateDocument(text: string): Promise<boolean> {
  // Basic validation
  if (!text) return false;
  if (text.length > 1000000) return false; // 1MB limit for safety
  
  // Check for malformed data
  try {
    // Test if the text contains valid structure
    if (text.includes('INDEXEDDB_ID:')) {
      const lines = text.split('\n');
      const hasValidStructure = lines.some(line => 
        line.trim().startsWith('MEDIA_TYPE:') || 
        line.trim().startsWith('MEDIA_NAME:')
      );
      return hasValidStructure;
    }
    
    if (text.includes('MEDIA_DATA:')) {
      // Check if base64 is valid
      const base64Match = text.match(/MEDIA_DATA:([^]*?)(?:MEDIA_TYPE:|$)/);
      if (base64Match) {
        const base64Data = base64Match[1].trim();
        return base64Data.startsWith('data:');
      }
    }
    
    return true;
    
  } catch (error) {
    console.error('🔍 SHERLOCK: Document validation failed:', error);
    return false;
  }
}