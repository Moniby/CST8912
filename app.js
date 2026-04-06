require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const session = require('express-session');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cst8912-simple-secret-2026',
  resave: false,
  saveUninitialized: true
}));

const config = {
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  options: { 
    encrypt: true, 
    trustServerCertificate: false 
  }
};

const blobBaseUrl = (process.env.AZURE_BLOB_BASE_URL || '').replace(/\/+$/, '');

function withBlobUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  const clean = url.startsWith('/') ? url.slice(1) : url;
  return blobBaseUrl ? `${blobBaseUrl}/${clean}` : url;
}

// Initialize and reset products with correct SVG paths
async function initDB() {
  try {
    const pool = await sql.connect(config);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Products' AND xtype='U')
      CREATE TABLE Products (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Name NVARCHAR(100) NOT NULL,
        Category NVARCHAR(50),
        Price DECIMAL(10,2) NOT NULL,
        Description NVARCHAR(255),
        ImageUrl NVARCHAR(255)
      );
    `);

    // Reset products to use correct SVG files
    await pool.request().query(`
      DELETE FROM Products;
      INSERT INTO Products (Name, Category, Price, Description, ImageUrl)
      VALUES 
      ('Classic Shirt', 'Shirt', 39.99, 'Comfortable cotton shirt for everyday wear.', '/images/shirt.svg'),
      ('Modern Pants', 'Pants', 59.99, 'Slim-fit pants with stretch fabric.', '/images/pants.svg'),
      ('Sport Sneakers', 'Sneakers', 89.99, 'Lightweight sneakers designed for comfort.', '/images/sneakers.svg');
    `);

    console.log('✅ Products reset with SVG images');
  } catch (err) {
    console.log('⚠️ DB warning:', err.message);
  }
}

async function getProducts() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT * FROM Products ORDER BY Id");
    return result.recordset.map(p => ({
      ...p,
      ImageUrl: withBlobUrl(p.ImageUrl)
    }));
  } catch (e) {
    return [
      { Id: 1, Name: "Classic Shirt", Category: "Shirt", Price: 39.99, ImageUrl: withBlobUrl("/images/shirt.svg") },
      { Id: 2, Name: "Modern Pants", Category: "Pants", Price: 59.99, ImageUrl: withBlobUrl("/images/pants.svg") },
      { Id: 3, Name: "Sport Sneakers", Category: "Sneakers", Price: 89.99, ImageUrl: withBlobUrl("/images/sneakers.svg") }
    ];
  }
}

async function getProductById(id) {
  const products = await getProducts();
  return products.find(p => Number(p.Id) === Number(id));
}

async function createOrder(customer, cart, payment) {
  const total = cart.reduce((sum, item) => sum + Number(item.product.Price) * item.quantity, 0);
  const pool = await sql.connect(config);

  const orderResult = await pool.request()
    .input('name', sql.NVarChar, customer.name)
    .input('email', sql.NVarChar, customer.email)
    .input('address', sql.NVarChar, customer.address)
    .input('total', sql.Decimal(10,2), total)
    .input('ref', sql.NVarChar, payment.reference)
    .input('status', sql.NVarChar, payment.status)
    .query(`
      INSERT INTO Orders (CustomerName, CustomerEmail, Shipping
