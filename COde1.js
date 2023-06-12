const fs = require("fs");
const puppeteer = require("puppeteer");
const mysql = require("mysql2");
const moment = require('moment');

const sleep = (milliseconds) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: false,
    userDataDir: "./tmp",
  });
  const page = await browser.newPage();
  const connection = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: 'Sahil@24',
    database: 'my_database'
  });
  connection.connect((err) => {
    if (err) {
      console.error("Error connecting to MySQL database", err);
      return;
    }
    console.log("Connected to MySQL database");
  });
  const query = "SELECT id, query, asin_no, active_status, last_crawled FROM search_queries";
  connection.query(query, async (error, results, fields) => {
    if (error) throw error;
    for (let i = 0; i < results.length; i++) {
      const searchQuery = results[i].query;
      const asinNo = results[i].asin_no;
      const activeStatus = results[i].active_status;

      // Check if the active status is "active" before searching
      if (activeStatus === "active") {
        const url = `https://www.amazon.in/s?k=${searchQuery}&ref=nb_sb_noss`;
        await page.goto(url);
        let page_num = 1;
        let isBtnDisabled = false;

        let asinFound = false; // Flag variable to track ASIN found or not
        while (!isBtnDisabled && page_num <= 5) {
          await page.waitForSelector('[data-cel-widget="search_result_0"]');
          const productsHandles = await page.$$(
            "div.s-main-slot.s-result-list.s-search-results.sg-row > .s-result-item"
          );
          let sponsored_position = 1;
          for (const producthandle of productsHandles) {
            let title = "Null";
            let sp = "Null";
            let asin = "Null";
            try {
              sp = await page.evaluate(
                (el) => el.querySelector(" a > span.puis-label-popover-default > span").textContent,
                producthandle);
            } catch (error) {}
            try {
              title = await page.evaluate(
                (el) => el.querySelector("h2 > a > span").textContent,
                producthandle);
            } catch (error) {}
            try {
              asin = await page.evaluate(
                (el) => el.getAttribute("data-asin"),
                producthandle);
            } catch (error) {}

            if (title !== "Null" && sp === "Sponsored") {
              // Insert data into MySQL
              const query = `INSERT INTO new_table (searchQuery, asin, page_num, sponsored_position, title, created_at) VALUES (?, ?, ?, ?, ?, NOW())`;
              const values = [searchQuery, asin, page_num, sponsored_position, title.replace(/,/g, ".")];

              try {
                connection.query(query, values, (error, results, fields) => {
                  if (error) {
                    // Skip insertion of duplicate records
                    if (error.code === 'ER_DUP_ENTRY') {
                      console.log('Skipping duplicate record:', values);
                    } else {
                      throw error;
                    }
                  } else {
                    console.log('Data inserted successfully!');
                  }
                });
              } catch (error) {
                console.error('Error inserting data into MySQL:', error);
              }
              fs.appendFile(
                "results.csv",
                `${page_num},${sponsored_position},${title.replace(/,/g, ".")},${asin}\n`,
                function (err) {
                  if (err) {
                    console.log("Error writing to file:", err);
                    throw err;
                  }
                }
              );
              sponsored_position++;

              if (asinNo === asin) {
                asinFound = true; // ASIN found
                const currentDateTime = moment().format("YYYY-MM-DD HH:mm:ss");
                connection.query(`UPDATE search_queries SET active_status = 'active', last_crawled = '${currentDateTime}', sponsored_position = ${sponsored_position}, page_num = ${page_num} WHERE id = ${results[i].id}`, (error, results, fields) => {
                  if (error) throw error;
                });
                connection.query(`UPDATE new_table SET matched = 'true' WHERE asin = '${asinNo}'`, (error, results, fields) => {
                  if (error) throw error;
                });
              }
            }

            if (asinNo === asin) {
              asinFound = true; // ASIN found
              const currentDateTime = moment().format("YYYY-MM-DD HH:mm:ss");
              connection.query(`UPDATE search_queries SET active_status = 'active', last_crawled = '${currentDateTime}', sponsored_position = ${sponsored_position}, page_num = ${page_num} WHERE id = ${results[i].id}`, (error, results, fields) => {
                if (error) throw error;
              });
              connection.query(`UPDATE new_table SET matched = 'true' WHERE asin = '${asinNo}'`, (error, results, fields) => {
                if (error) throw error;
              });
            }
          }

          // If ASIN is not found, update active_status as 'not active' and last_crawled time
          if (!asinFound) {
            const currentDateTime = moment().format("YYYY-MM-DD HH:mm:ss");
            connection.query(`UPDATE search_queries SET active_status = 'not active', last_crawled = '${currentDateTime}' WHERE id = ${results[i].id}`, (error, results, fields) => {
              if (error) throw error;
            });
          }

          await page.waitForSelector(".s-pagination-item.s-pagination-next", { visible: true });
          const is_disabled = (await page.$(".span.s-pagination-item.s-pagination-next.s-pagination-disabled")) !== null;

          isBtnDisabled = is_disabled;
          if (!is_disabled) {
            page_num++;
            await Promise.all([
              page.click(".s-pagination-item.s-pagination-next"),
              page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
            ]);
          }
        }
      }
    }
    await browser.close();
  });
})();
