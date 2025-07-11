require('dotenv').config(); // Load from .env
const puppeteer = require('puppeteer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// 🗓 Stage dates mapped to stage numbers
const stageMap = {
  '2025-07-05': 1, '2025-07-06': 2, '2025-07-07': 3, '2025-07-08': 4,
  '2025-07-09': 5, '2025-07-10': 6, '2025-07-11': 7, '2025-07-12': 8,
  '2025-07-13': 9, '2025-07-14': 10, '2025-07-16': 11, '2025-07-17': 12,
  '2025-07-18': 13, '2025-07-19': 14, '2025-07-20': 15, '2025-07-22': 16,
  '2025-07-23': 17, '2025-07-24': 18, '2025-07-25': 19, '2025-07-26': 20,
  '2025-07-27': 21
};

// 🕷 Scrape the current stage data
async function scrapeStageData(stageNumber) {

  const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',                // outer container already isolates you
    '--disable-setuid-sandbox',    // helper binary isn’t present
    '--disable-dev-shm-usage'      // ← extra flag for low /dev/shm memory
  ]
});
  
  const page = await browser.newPage();

  const stageUrl = `https://www.procyclingstats.com/race/tour-de-france/2025/stage-${stageNumber}/live`;
  console.log(`Scraping stage ${stageNumber} from: ${stageUrl}`);
  await page.goto(stageUrl, { waitUntil: 'domcontentloaded' });

  const groups = await page.evaluate(() => {
    const groups = [];
    const groupElements = document.querySelectorAll('.situCont > .situ5b > li.group');
    let seenFirstPosition1 = false;

    for (const groupEl of groupElements) {
      const position = groupEl.querySelector('.bol font')?.innerText.trim() || 'Unknown';

      if (position === '1') {
        if (seenFirstPosition1) break;
        seenFirstPosition1 = true;
      }

      const timeGap = groupEl.querySelector('.time')?.childNodes[0]?.textContent.trim() || '0s';

      const riderEls = groupEl.querySelectorAll('ul > li');
      const riders = Array.from(riderEls).map(li =>
        li.querySelector('a')?.innerText.trim()
      ).filter(Boolean);

      groups.push({ position, timeGap, riders });
    }

    return groups;
  });

  await browser.close();
  return groups;
}

// ☁️ Upload to AWS S3
async function uploadToS3(data, stageNumber) {
  const region      = process.env.AWS_REGION;
  const bucketName  = process.env.S3_BUCKET_NAME;
  const timestamp   = new Date().toISOString().replace(/[:.]/g, '-');

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  // 1️⃣  Store the timestamped object (keeps full history)
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key:    `stage-${stageNumber}/${timestamp}.json`,
    Body:   JSON.stringify(data, null, 2),
    ContentType: 'application/json'
  }));

  // 2️⃣  Over-write /stage-N/latest.json with the same payload
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key:    `stage-${stageNumber}/latest.json`,
    Body:   JSON.stringify(data, null, 2),
    ContentType: 'application/json'
  }));

  console.log(
    `✅ Uploaded   → https://${bucketName}.s3.${region}.amazonaws.com/stage-${stageNumber}/${timestamp}.json\n` +
    `✅ Latest now → https://${bucketName}.s3.${region}.amazonaws.com/stage-${stageNumber}/latest.json`
  );
}


// 🚀 Main
(async () => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]; // e.g., "2025-07-14"
  const stageNumber = stageMap[todayStr];

  if (!stageNumber) {
    console.log('No stage scheduled for today.');
    return;
  }

  try {
    const scraped = await scrapeStageData(stageNumber);
    await uploadToS3(scraped, stageNumber);
  } catch (err) {
    console.error('❌ Error:', err);
  }
})();
