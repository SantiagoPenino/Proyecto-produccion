const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  
  try {
    await page.goto('http://localhost:5173/admin/products-integration', { waitUntil: 'networkidle2' });
    
    // Wait a bit to let it load
    await new Promise(r => setTimeout(r, 2000));
    
    console.log('Evaluating click on Productos filter...');
    await page.evaluate(() => {
        // Try to click the "Productos" button
        const btns = Array.from(document.querySelectorAll('button'));
        const prodBtn = btns.find(b => b.textContent.includes('Productos'));
        if (prodBtn) prodBtn.click();
    });
    
    await new Promise(r => setTimeout(r, 2000));
    console.log('Done.');
  } catch (err) {
    console.error('Failed:', err);
  } finally {
    await browser.close();
  }
})();
