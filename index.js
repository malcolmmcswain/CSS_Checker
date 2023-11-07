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
  const resourcePrefix = isStylesheet ? "css" : "html";
  const counter = isStylesheet ? ++styleSheetCounter : ++htmlFileCounter;
  const resourceFileName = `${folderName}_${counter}_${resourceName}`;
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

  for (const filePath of cssFilePaths) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    console.log(`Analyzing ${filePath}:`);

    // Initialize flags
    let flexOrGridFound = false;
    let cssVariablesFound = false;
    let fallbackFontsFound = false;

    // Check each line for the CSS properties
    lines.forEach((line) => {
      if (!flexOrGridFound && line.match(/display:\s*(flex|grid)/)) {
        console.log(`- Uses Flexbox or Grid: ${line.trim()}`);
        flexOrGridFound = true;
      }

      if (!cssVariablesFound && line.match(/var\(--[\w-]+\)/)) {
        console.log(`- Uses CSS variables: ${line.trim()}`);
        cssVariablesFound = true;
      }

      if (!fallbackFontsFound && line.match(/font-family:.*?,/)) {
        console.log(`- Uses fallback fonts: ${line.trim()}`);
        fallbackFontsFound = true;
      }
    });

    // Check for absence
    if (!flexOrGridFound) {
      console.log("- Flexbox or Grid not used.");
    }
    if (!cssVariablesFound) {
      console.log("- CSS variables not used.");
    }
    if (!fallbackFontsFound) {
      console.log("- Fallback fonts not used.");
    }
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
}

const startUrl = process.argv[2];
startCrawl(startUrl);
