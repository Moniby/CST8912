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

async function initDB() {
  try {
    const pool = await sql.connect(config);
    // ... (same table creation as before - keeping it short for now)
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Products' AND xtype='U')
      CREATE TABLE Products (Id INT IDENTITY(1,1) PRIMARY KEY, Name NVARCHAR(100), Category NVARCHAR(50), Price DECIMAL(10,2), Description NVARCHAR(255), ImageUrl NVARCHAR(255));
    `);

    const count = await pool.request().query("SELECT COUNT(*) as cnt FROM Products");
    if (count.recordset[0].cnt === 0) {
      await pool.request().query(`
        INSERT INTO Products (Name, Category, Price, Description, ImageUrl)
        VALUES 
        ('Classic Shirt', 'Shirt', 39.99, 'Comfortable cotton shirt', '/images/shirt.svg'),
        ('Modern Pants', 'Pants', 59.99, 'Slim-fit pants', '/images/pants.svg'),
        ('Sport Sneakers', 'Sneakers', 89.99, 'Lightweight sneakers', '/images/sneakers.svg');
      `);
    }

    console.log('✅ Azure SQL ready');
  } catch (err) {
    console.log('⚠️ DB warning:', err.message);
  }
}

async function getProducts() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT * FROM Products ORDER BY Id");
    return result.recordset.map(p => ({ ...p, ImageUrl: withBlobUrl(p.ImageUrl) }));
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

// Safe render helper
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
    product: null
  };
  res.render(view, { ...defaults, ...data });
}

// Routes
app.get('/', async (req, res) => {
  const products = await getProducts();
  safeRender(res, 'index', { 
    title: "CST8912 Ecommerce Store Project", 
    products, 
    cartCount: (req.session.cart || []).length 
  });
});

app.get('/products', async (req, res) => {
  const search = (req.query.search || '').trim();
  const category = (req.query.category || '').trim();

  let products = await getProducts();

  if (search) {
    products = products.filter(p => 
      p.Name.toLowerCase().includes(search.toLowerCase()) || 
      (p.Description && p.Description.toLowerCase().includes(search.toLowerCase()))
    );
  }
  if (category) {
    products = products.filter(p => p.Category === category);
  }

  const categories = [...new Set((await getProducts()).map(p => p.Category))];

  safeRender(res, 'index', {   // many templates use 'index' for products page
    title: "Products",
    products,
    categories,
    search,
    selectedCategory: category,
    cartCount: (req.session.cart || []).length
  });
});

app.get('/product/:id', async (req, res) => {
  const product = await getProductById(req.params.id);
  if (!product) return res.send("Product not found");
  safeRender(res, 'product', { 
    title: product.Name, 
    product, 
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

app.post('/cart/update', (req, res) => {
  const cart = req.session.cart || [];
  const idx = parseInt(req.body.index);
  if (cart[idx]) cart[idx].quantity = parseInt(req.body.quantity) || 1;
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const cart = req.session.cart || [];
  const idx = parseInt(req.body.index);
  if (cart[idx]) cart.splice(idx, 1);
  res.redirect('/cart');
});

app.get('/checkout', (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length === 0) return res.redirect('/products');
  const total = cart.reduce((sum, item) => sum + Number(item.product.Price) * item.quantity, 0);
  safeRender(res, 'checkout', { title: "Checkout", cart, total, cartCount: cart.length, error: null });
});

app.post('/checkout', async (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length === 0) return res.redirect('/products');
  const { name, email, address, cardNumber } = req.body;
  try {
    const payment = processPayment(cardNumber);
    const orderId = await createOrder({ name, email, address }, cart, payment);
    req.session.cart = [];
    res.redirect(`/order/${orderId}`);
  } catch (err) {
    const total = cart.reduce((sum, item) => sum + Number(item.product.Price) * item.quantity, 0);
    safeRender(res, 'checkout', { title: "Checkout", cart, total, cartCount: cart.length, error: err.message });
  }
});

app.get('/order/:id', (req, res) => {
  safeRender(res, 'order-success', { 
    title: `Order #${req.params.id}`, 
    orderId: req.params.id, 
    cartCount: 0 
  });
});

function processPayment(cardNumber) {
  const clean = String(cardNumber || '').replace(/\D/g, '');
  if (clean.length < 12) throw new Error("Invalid card number");
  return { reference: `pay_${Date.now()}`, status: "PAID" };
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
      INSERT INTO Orders (CustomerName, CustomerEmail, ShippingAddress, TotalAmount, PaymentReference, PaymentStatus)
      OUTPUT INSERTED.Id VALUES (@name, @email, @address, @total, @ref, @status)
    `);

  const orderId = orderResult.recordset[0].Id;

  for (const item of cart) {
    await pool.request()
      .input('orderId', sql.Int, orderId)
      .input('name', sql.NVarChar, item.product.Name)
      .input('price', sql.Decimal(10,2), item.product.Price)
      .input('qty', sql.Int, item.quantity)
      .query(`INSERT INTO OrderItems (OrderId, ProductName, UnitPrice, Quantity) VALUES (@orderId, @name, @price, @qty)`);
  }
  return orderId;
}

initDB().then(() => {
  app.listen(port, () => console.log(`🚀 CST8912 running`));
});
