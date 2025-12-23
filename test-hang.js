// Test script per verificare l'hang infinito
const { chromium } = require('playwright');

async function testHang() {
  console.log('🔍 TESTING: Avvio test hang infinito...');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Intercetta log console
  page.on('console', msg => {
    if (msg.text().includes('[') && msg.text().includes('ms]')) {
      console.log('📊 INIT LOG:', msg.text());
    }
  });
  
  console.log('🌐 Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  
  console.log('⏱️  Waiting for "Initializing system..." to appear...');
  try {
    await page.waitForText('Initializing system...', { timeout: 2000 });
    console.log('✅ Loading screen appeared');
    
    console.log('⏱️  Waiting for loading to complete (max 10s)...');
    
    // Aspetta che sparisca il loading screen O che appaia app content
    const result = await Promise.race([
      page.waitForFunction(() => {
        return !document.querySelector('text-content') ||
               !document.textContent.includes('Initializing system...');
      }, { timeout: 10000 }),
      page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 }).catch(() => null)
    ]);
    
    if (result) {
      console.log('✅ SUCCESS: App loaded within 10s');
    } else {
      console.log('❌ HANG DETECTED: Still loading after 10s');
      
      // Screenshot per debug
      await page.screenshot({ path: 'hang-screenshot.png' });
      console.log('📸 Screenshot saved: hang-screenshot.png');
    }
    
  } catch (error) {
    console.log('❌ LOADING SCREEN NOT FOUND:', error.message);
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await browser.close();
}

if (require.main === module) {
  testHang().catch(console.error);
}

module.exports = { testHang };