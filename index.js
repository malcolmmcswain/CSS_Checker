const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");
const URL = require("url").URL;

const visitedUrls = new Set();
let styleSheetCounter = 0;
let htmlFileCounter = 0;

async function downloadResource(resourceUrl, folderName, isStylesheet) {
  const resourceName = path.basename(resourceUrl);
  if (resourceName.includes(".pdf")) return;
  const counter = isStylesheet ? ++styleSheetCounter : ++htmlFileCounter;
  const resourceFileName = isStylesheet ? `${folderName}_${counter}_${resourceName}` : `${folderName}_${counter}_${resourceName}.html`;
  const resourceFilePath = path.join(folderName, resourceFileName);

  try {
    const response = await axios({
      method: "get",
      url: resourceUrl,
      responseType: "stream",
    });
    await new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(resourceFilePath))
        .on("finish", () => resolve())
        .on("error", (error) => reject(error));
    });

    return resourceFilePath;
  } catch (error) {
    console.error(`Error downloading ${resourceUrl}: ${error.message}`);
    return null;
  }
}

async function analyzeCSSFiles(folderName) {
  const cssFiles = await fs.readdir(folderName);
  const cssFilePaths = cssFiles
    .filter((file) => file.endsWith(".css"))
    .map((file) => path.join(folderName, file));

  console.log('\nCSS ANALYSIS:\n');

  // Initialize flags
  let flexOrGridFound = false;
  let cssVariablesFound = false;
  let fallbackFontsFound = false;
  let relativeUnitsFound = false;
  let dynamicViewportUnitsFound = false;
  let animationsFound = false;
  let transitionsFound = false;
  let transformsFound = false;
  let advancedColorFunctionsFound = false;
  let pseudoClassesFound = false;
  let mediaQueries = [];

  for (const filePath of cssFilePaths) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    console.log(`Analyzing ${filePath}...`);

    // Check each line for the CSS properties
    lines.forEach((line) => {
      if (!flexOrGridFound && line.match(/display:\s*(flex|grid)/)) {
        console.log(`✓ Uses Flexbox or Grid: \n${line.trim()}`);
        flexOrGridFound = true;
      }

      if (!cssVariablesFound && line.match(/var\(--/)) {
        console.log(`✓ Uses CSS variables: \n${line.trim()}`);
        cssVariablesFound = true;
      }

      if (!fallbackFontsFound && line.match(/font-family:.*?,/)) {
        console.log(`✓ Uses fallback fonts: \n${line.trim()}`);
        fallbackFontsFound = true;
      }

      if (!relativeUnitsFound && line.match(/(em|vh|vw|%)|calc\(/)) {
        console.log(`✓ Uses relative units: \n${line.trim()}`);
        relativeUnitsFound = true;
      }

      if (!dynamicViewportUnitsFound && line.match(/dvw|dvh/)) {
        console.log(`✓ Uses dynamic viewport units: \n${line.trim()}`);
        dynamicViewportUnitsFound = true;
      }

      if (!animationsFound && line.match(/@keyframes|animation:/)) {
        console.log(`✓ Uses animations: \n${line.trim()}`);
        animationsFound = true;
      }

      if (!transitionsFound && line.match(/transition:/)) {
        console.log(`✓ Uses transitions: \n${line.trim()}`);
        transitionsFound = true;
      }

      if (!transformsFound && line.match(/transform:/)) {
        console.log(`✓ Uses transforms: \n${line.trim()}`);
        transformsFound = true;
      }

      if (!advancedColorFunctionsFound && line.match(/color\(|color-mix\(/)) {
        console.log(`✓ Uses advanced color functions: \n${line.trim()}`);
        advancedColorFunctionsFound = true;
      }

      if (!pseudoClassesFound && line.match(/:has\(|:is\(|:where\(/)) {
        console.log(`✓ Uses has(), is(), or where() pseudo-classes: \n${line.trim()}`);
        pseudoClassesFound = true;
      }

      if (line.match(/@media/)) {
        mediaQueries.push(line.trim());
      }
    });
  }

  // Check for absence
  if (!flexOrGridFound) console.log("✗ Flexbox or Grid not used.");
  if (!cssVariablesFound) console.log("✗ CSS variables not used.");
  if (!fallbackFontsFound) console.log("✗ Fallback fonts not used.");
  if (!relativeUnitsFound) console.log("✗ Relative units not used.");
  if (!dynamicViewportUnitsFound) console.log("✗ Dynamic viewport units not used.");
  if (!animationsFound) console.log("✗ Animations not used.");
  if (!transitionsFound) console.log("✗ Transitions not used.");
  if (!transformsFound) console.log("✗ Transforms not used.");
  if (!advancedColorFunctionsFound) console.log("✗ Advanced color functions not used.");
  if (!pseudoClassesFound) console.log("✗ has(), is(), or where() pseudo-classes not used.");

  console.log("\nMedia queries:");
  mediaQueries.forEach((query, _) => { console.log(query); })
}

async function analyzeHTMLFiles(folderName) {
  const htmlFiles = await fs.readdir(folderName);
  const htmlFilePaths = htmlFiles
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.join(folderName, file));

  console.log("\n\nHTML ANALYSIS:\n");

  for (const filePath of htmlFilePaths) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    console.log(`Analyzing ${filePath}...`);

    // Check each line for the HTML elements
    lines.forEach((line, index) => {
      if (line.includes('<img')) {
        console.log(`- <img> tag found on line ${index + 1}: ${line.trim()}`);
      }

      if (line.includes('<picture')) {
        console.log(`- <picture> tag found on line ${index + 1}: ${line.trim()}`);
      }
    });
  }
}

async function fetchAndProcessUrl(
  urlToFetch,
  baseUrl,
  folderName,
  downloadQueue
) {
  if (visitedUrls.has(urlToFetch)) {
    return;
  }

  visitedUrls.add(urlToFetch);

  try {
    const response = await axios.get(urlToFetch);
    const $ = cheerio.load(response.data);

    // Download HTML file
    downloadQueue.push(downloadResource(urlToFetch, folderName, false));

    // Download all stylesheets
    $('link[rel="stylesheet"]').each((index, element) => {
      const href = $(element).attr("href");
      if (href && !href.startsWith("//") && !href.includes("#")) {
        const styleUrl = new URL(href, baseUrl).href;
        downloadQueue.push(downloadResource(styleUrl, folderName, true));
      }
    });

    // Find all internal links and process them
    $("a").each((index, element) => {
      const href = $(element).attr("href");
      if (href && !href.startsWith("#") && !href.startsWith("mailto:")) {
        const nextUrl = new URL(href, baseUrl).href;
        if (nextUrl.startsWith(baseUrl) && !visitedUrls.has(nextUrl)) {
          downloadQueue.push(
            fetchAndProcessUrl(nextUrl, baseUrl, folderName, downloadQueue)
          );
        }
      }
    });
  } catch (error) {
    console.error(`Error fetching ${urlToFetch}: ${error.message}`);
  }
}

async function startCrawl(startUrl) {
  const parsedUrl = new URL(startUrl);
  const folderName = parsedUrl.hostname.replace(/\./g, "_");

  // Ensure the directory exists
  await fs.ensureDir(folderName);

  const downloadQueue = [];
  await fetchAndProcessUrl(
    startUrl,
    parsedUrl.origin,
    folderName,
    downloadQueue
  );

  // Wait for all downloads to finish
  await Promise.all(downloadQueue);

  // Once all files are downloaded, analyze the CSS files
  await analyzeCSSFiles(folderName);
  await analyzeHTMLFiles(folderName);
}

const startUrl = process.argv[2];
startCrawl(startUrl);
