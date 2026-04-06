# CST8912 Ecommerce Store Project

Green-themed ecommerce website for `Shirt`, `Pants`, and `Sneakers`, built with Node.js/Express and connected to Azure SQL Database. Designed for deployment to Azure App Service and source control on GitHub.

## Tech Stack

- Node.js + Express
- EJS templating
- Azure SQL Database (`mssql` package)
- Azure App Service compatible startup (`npm start`)

## Project Structure

- `src/server.js` - Express app and routes
- `src/db.js` - Azure SQL connection and product data setup
- `views/` - EJS templates
- `public/styles/main.css` - Green UI theme
- `public/images/` - Product SVG images

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and update values:

   - `AZURE_SQL_SERVER`
   - `AZURE_SQL_DATABASE`
   - `AZURE_SQL_USER`
   - `AZURE_SQL_PASSWORD`
   - `AZURE_SQL_ENCRYPT`

3. Run locally:

   ```bash
   npm start
   ```

4. Open:

   [http://localhost:3000](http://localhost:3000)

## Azure SQL Notes

On first startup, the app:

- creates a `Products` table if it does not exist
- inserts starter products (`Shirt`, `Pants`, `Sneakers`) if table is empty

## Deploy to Azure App Service

1. Push this project to your GitHub repository.
2. In Azure Portal, open your App Service.
3. Go to **Deployment Center** and connect your GitHub repo.
4. In App Service **Configuration**, add app settings from `.env`.
5. Save and restart the app.

## Next Improvements

- Add customer registration and login
- Add cart and checkout
- Add admin dashboard for products
