// Playwright test to verify infinite loading hang is fixed
const { test, expect } = require('@playwright/test');

test.describe('Life Tracker Initialization', () => {
  test('should complete initialization within 5 seconds', async ({ page }) => {
    console.log('🧪 TEST: Starting infinite hang test...');
    
    // Intercept console logs to track initialization
    const initLogs = [];
    page.on('console', msg => {
      if (msg.text().includes('[') && msg.text().includes('ms]')) {
        initLogs.push(msg.text());
        console.log('📊 INIT LOG:', msg.text());
      }
    });
    
    // Navigate to app
    console.log('🌐 Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000');
    
    // Wait for initial loading screen (should appear quickly)
    console.log('⏱️  Waiting for loading state...');
    
    // Test 1: App should reach a final state within 5 seconds
    const startTime = Date.now();
    
    try {
      // Wait for either success (app loaded) or error state (both are acceptable)
      await Promise.race([
        // Success path: loading disappears
        page.waitForFunction(() => {
          return !document.textContent.includes('Initializing system...');
        }, { timeout: 5000 }),
        
        // Error path: error screen appears
        page.waitForSelector('text=Initialization Failed', { timeout: 5000 })
      ]);
      
      const totalTime = Date.now() - startTime;
      console.log(`✅ SUCCESS: Initialization completed or failed gracefully in ${totalTime}ms`);
      
      // Verify no infinite loading
      const isStillLoading = await page.textContent('body').then(text => 
        text.includes('Initializing system...')
      );
      
      expect(isStillLoading).toBe(false);
      expect(totalTime).toBeLessThan(5000);
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.log(`❌ HANG DETECTED: Still loading after ${totalTime}ms`);
      
      // Take screenshot for debugging
      await page.screenshot({ path: 'hang-detection.png' });
      
      // Check if it's still in loading state
      const loadingElement = await page.$('text=Initializing system...');
      if (loadingElement) {
        throw new Error(`INFINITE HANG: Still showing "Initializing system..." after ${totalTime}ms`);
      }
      
      throw error;
    }
  });
  
  test('should show proper error screen on initialization failure', async ({ page }) => {
    // This test simulates network issues
    console.log('🧪 TEST: Testing error handling...');
    
    // Block all network requests to simulate failure
    await page.route('**/*', route => route.abort());
    
    await page.goto('http://localhost:3000');
    
    // Should show error screen, not infinite loading
    const errorScreen = await Promise.race([
      page.waitForSelector('text=Initialization Failed', { timeout: 6000 }),
      page.waitForSelector('text=Retry Initialization', { timeout: 6000 })
    ]);
    
    expect(errorScreen).toBeTruthy();
    
    // Verify retry button works
    const retryButton = await page.$('text=Retry Initialization');
    expect(retryButton).toBeTruthy();
  });
  
  test('should handle IndexedDB blocked scenario gracefully', async ({ page }) => {
    console.log('🧪 TEST: Testing IndexedDB blocked scenario...');
    
    // Simulate IndexedDB being blocked
    await page.addInitScript(() => {
      const originalOpen = window.indexedDB.open;
      window.indexedDB.open = function(...args) {
        const request = originalOpen.apply(this, args);
        // Simulate blocked event after short delay
        setTimeout(() => {
          const event = new Event('blocked');
          request.dispatchEvent(event);
        }, 100);
        return request;
      };
    });
    
    await page.goto('http://localhost:3000');
    
    // Should handle blocked DB and show error, not hang
    const result = await Promise.race([
      page.waitForSelector('text=Initialization Failed', { timeout: 5000 }),
      page.waitForFunction(() => {
        return !document.textContent.includes('Initializing system...');
      }, { timeout: 5000 })
    ]);
    
    expect(result).toBeTruthy();
  });
});

// Manual test function
async function runManualTest() {
  console.log('🔧 MANUAL TEST: Use this to verify manually');
  console.log('1. Open http://localhost:3000');
  console.log('2. Check console for init logs');
  console.log('3. Verify it reaches READY or ERROR within 5s');
  console.log('4. Verify no infinite "Initializing system..." screen');
}

if (require.main === module) {
  runManualTest();
}