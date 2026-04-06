const express = require('express');
const sql = require('mssql');
const session = require('express-session');
const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true
}));

const upload = multer({ storage: multer.memoryStorage() });

// Azure SQL CONFIG (UPDATE)
const config = {
    user: 'CommerceProj',
    password: 'Com@2026',
    server: 'ecommerce-sql-unique.database.windows.net',
    database: 'ecommerce-db',
    options: { encrypt: true }
};

// Azure Blob CONFIG (UPDATE)
const blobServiceClient = BlobServiceClient.fromConnectionString("YOUR_CONNECTION_STRING");
const containerName = "product-images";

// Init cart
app.use((req, res, next) => {
    if (!req.session.cart) req.session.cart = [];
    next();
});

// HOME
app.get('/', async (req, res) => {
    let pool = await sql.connect(config);
    let result = await pool.request().query("SELECT TOP 6 * FROM Products");
    res.render('index', { products: result.recordset });
});

// PRODUCTS + SEARCH
app.get('/products', async (req, res) => {
    const search = req.query.search || '';
    let pool = await sql.connect(config);

    let result = await pool.request()
        .input('search', sql.NVarChar, `%${search}%`)
        .query("SELECT * FROM Products WHERE Name LIKE @search");

    res.render('products', { products: result.recordset, search });
});

// PRODUCT PAGE
app.get('/product/:id', async (req, res) => {
    let pool = await sql.connect(config);
    let result = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query("SELECT * FROM Products WHERE Id=@id");

    res.render('product', { product: result.recordset[0] });
});

// CART
app.post('/cart/add', async (req, res) => {
    let pool = await sql.connect(config);
    let result = await pool.request()
        .input('id', sql.Int, req.body.productId)
        .query("SELECT * FROM Products WHERE Id=@id");

    req.session.cart.push({ product: result.recordset[0], quantity: 1 });
    res.redirect('/cart');
});

app.get('/cart', (req, res) => {
    res.render('cart', { cart: req.session.cart });
});

app.post('/cart/update', (req, res) => {
    req.session.cart[req.body.index].quantity = parseInt(req.body.quantity);
    res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
    req.session.cart.splice(req.body.index, 1);
    res.redirect('/cart');
});

// AUTH
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
    let pool = await sql.connect(config);

    await pool.request()
        .input('name', sql.NVarChar, req.body.name)
        .input('email', sql.NVarChar, req.body.email)
        .input('password', sql.NVarChar, req.body.password)
        .query("INSERT INTO Users (Name, Email, Password, Role) VALUES (@name,@email,@password,'user')");

    res.redirect('/login');
});

app.post('/login', async (req, res) => {
    let pool = await sql.connect(config);

    let result = await pool.request()
        .input('email', sql.NVarChar, req.body.email)
        .input('password', sql.NVarChar, req.body.password)
        .query("SELECT * FROM Users WHERE Email=@email AND Password=@password");

    if (result.recordset.length > 0) {
        req.session.user = result.recordset[0];
        res.redirect('/');
    } else res.send("Invalid login");
});

// CHECKOUT
app.get('/checkout', (req, res) => res.render('checkout'));

app.post('/checkout', async (req, res) => {
    let pool = await sql.connect(config);

    for (let item of req.session.cart) {
        await pool.request()
            .input('userId', sql.Int, req.session.user?.Id || 1)
            .input('productId', sql.Int, item.product.Id)
            .input('quantity', sql.Int, item.quantity)
            .query("INSERT INTO Orders (UserId, ProductId, Quantity) VALUES (@userId,@productId,@quantity)");
    }

    req.session.cart = [];
    res.send("Payment successful!");
});

// ADMIN
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.Role === 'admin') next();
    else res.send("Access denied");
}

app.get('/admin', isAdmin, async (req, res) => {
    let pool = await sql.connect(config);

    let products = await pool.request().query("SELECT * FROM Products");
    let orders = await pool.request().query("SELECT * FROM Orders");

    res.render('admin', { products: products.recordset, orders: orders.recordset });
});

// IMAGE UPLOAD
app.post('/admin/upload', isAdmin, upload.single('image'), async (req, res) => {

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobName = Date.now() + "-" + req.file.originalname;

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer);

    const imageUrl = blockBlobClient.url;

    let pool = await sql.connect(config);

    await pool.request()
        .input('name', sql.NVarChar, req.body.name)
        .input('price', sql.Decimal, req.body.price)
        .input('image', sql.NVarChar, imageUrl)
        .query("INSERT INTO Products (Name, Price, ImageUrl) VALUES (@name,@price,@image)");

    res.redirect('/admin');
});

app.listen(process.env.PORT || 3000);
