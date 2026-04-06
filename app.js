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
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using production HTTPS
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

// Database Initialization
async function initDB() {
  try {
    const pool = await sql.connect(config);
    
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Products' AND xtype='U')
      CREATE TABLE Products (Id INT IDENTITY(1,1) PRIMARY KEY, Name NVARCHAR(100), Category NVARCHAR(50), Price DECIMAL(10,2), Description NVARCHAR(255), ImageUrl NVARCHAR(255));
      
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Orders' AND xtype='U')
      CREATE TABLE Orders (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          CustomerName NVARCHAR(100),
          ShippingAddress NVARCHAR(MAX),
          TotalAmount DECIMAL(10,2),
          PaymentReference NVARCHAR(100),
          OrderDate DATETIME DEFAULT GETDATE()
      );

      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='OrderItems' AND xtype='U')
      CREATE TABLE OrderItems (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          OrderId INT FOREIGN KEY REFERENCES Orders(Id),
          ProductName NVARCHAR(100),
          Quantity INT,
          PriceAtPurchase DECIMAL(10,2)
      );
    `);

    console.log('✅ Azure SQL tables verified');
  } catch (err) {
    console.log('⚠️ DB Init warning:', err.message);
  }
}

async function getProducts() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT * FROM Products ORDER BY Id");
    return result.recordset.map(p => ({ ...p, ImageUrl: withBlobUrl(p.ImageUrl) }));
  } catch (e) {
    return [];
  }
}

async function getProductById(id) {
  const products = await getProducts();
  return products.find(p => Number(p.Id) === Number(id));
}

function safeRender(res, view, data = {}) {
  const defaults = {
    title: "CST8912 Ecommerce",
    products: [],
    categories: [],
    search: "",
    selectedCategory: "",
    cartCount: 0,
    cart: [],
    total: 0,
    error: null,
    orderId: "",
    message: ""
  };
  res.render(view, { ...defaults, ...data });
}

// --- Routes ---

app.get('/', async (req, res) => {
  const products = await getProducts();
  safeRender(res, 'index', { 
    title: "Home", 
    products, 
    cartCount: (req.session.cart || []).length 
  });
});

app.get('/products', async (req, res) => {
  const products = await getProducts();
  const categories = [...new Set(products.map(p => p.Category))];
  safeRender(res, 'index', { 
    title: "Products",
    products,
    categories,
    cartCount: (req.session.cart || []).length
  });
});

app.get('/about', (req, res) => {
  res.render('about', { 
    title: 'About Us',
    cartCount: req.session.cart ? req.session.cart.length : 0 
  });
});

app.post('/cart/add', async (req, res) => {
  const product = await getProductById(req.body.productId);
  if (!product) return res.redirect('/products');
  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => Number(i.product.Id) === Number(product.Id));
  if (existing) existing.quantity++;
  else req.session.cart.push({ product, quantity: 1 });
  res.redirect('/cart');
});

app.get('/cart', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + Number(item.product.Price) * item.quantity, 0);
  safeRender(res, 'cart', { title: "Your Cart", cart, total, cartCount: cart.length });
});

app.get('/checkout', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + Number(item.product.Price) * item.quantity, 0);
  safeRender(res, 'checkout', { title: "Checkout", cart, total, cartCount: cart.length });
});

// IMPROVED CHECKOUT ROUTE
app.post('/checkout', async (req, res) => {
  let cart = req.session.cart || [];
  const { customerName, address } = req.body;
  
  const total = cart.reduce((sum, item) => {
    const price = (item.product && item.product.Price) ? Number(item.product.Price) : 0;
    return sum + (price * item.quantity);
  }, 0);

  try {
    console.log(`Processing order for ${customerName}. Items in cart: ${cart.length}`);
    const demoPaymentRef = "DEMO-" + Math.random().toString(36).substring(2, 11).toUpperCase();

    const pool = await sql.connect(config);
    const transaction = new sql.Transaction(pool);
    
    await transaction.begin();
    try {
      const orderResult = await transaction.request()
        .input('name', sql.NVarChar, customerName || 'Test User')
        .input('address', sql.NVarChar, address || 'Test Address')
        .input('total', sql.Decimal(10, 2), total)
        .input('ref', sql.NVarChar, demoPaymentRef)
        .query(`INSERT INTO Orders (CustomerName, ShippingAddress, TotalAmount, PaymentReference) 
                OUTPUT INSERTED.Id VALUES (@name, @address, @total, @ref)`);
      
      const orderId = orderResult.recordset[0].Id;

      if (cart.length > 0) {
        for (const item of cart) {
          await transaction.request()
            .input('orderId', sql.Int, orderId)
            .input('name', sql.NVarChar, item.product.Name)
            .input('qty', sql.Int, item.quantity)
            .input('price', sql.Decimal(10, 2), item.product.Price)
            .query(`INSERT INTO OrderItems (OrderId, ProductName, Quantity, PriceAtPurchase) 
                    VALUES (@orderId, @name, @qty, @price)`);
        }
      }

      await transaction.commit();
      req.session.cart = [];
      
      return res.render('order-success', { 
        title: 'Order Confirmed', 
        orderId, 
        total, 
        message: "Order successfully placed!", 
        cartCount: 0 
      });

    } catch (dbErr) {
      if (transaction) await transaction.rollback();
      throw dbErr;
    }
  } catch (err) {
    console.error("CRITICAL DATABASE ERROR:", err.message);
    return res.render('checkout', { 
      title: "Checkout Error", 
      cart, 
      total, 
      cartCount: cart.length, 
      error: "Database error: " + err.message 
    });
  }
});

app.get('/order/:id', (req, res) => {
  safeRender(res, 'order-success', { 
    title: `Order Confirmed`, 
    orderId: req.params.id,
    message: "Order found!",
    cartCount: 0 
  });
});

initDB().then(() => {
  app.listen(port, () => console.log(`🚀 Server active on port ${port}`));
});
