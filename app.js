require("./src/server");
const express = require('express');
const sql = require('mssql');
const session = require('express-session');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.set('view engine', 'ejs');

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true
}));

// Initialize cart
app.use((req, res, next) => {
    if (!req.session.cart) req.session.cart = [];
    next();
});

// DB CONFIG (UPDATE THIS)
const config = {
    user: 'CommerceProj',
    password: 'Com@2026',
    server: 'ecommerce-sql-unique.database.windows.net',
    database: 'ecommerce-db',
    options: { encrypt: true }
};

// HOME
app.get('/', async (req, res) => {
    let pool = await sql.connect(config);
    let result = await pool.request().query("SELECT TOP 3 * FROM Products");
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

// PRODUCT DETAILS
app.get('/product/:id', async (req, res) => {
    let pool = await sql.connect(config);
    let result = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query("SELECT * FROM Products WHERE Id = @id");

    res.render('product', { product: result.recordset[0] });
});

// ADD TO CART
app.post('/cart/add', async (req, res) => {
    let pool = await sql.connect(config);
    let result = await pool.request()
        .input('id', sql.Int, req.body.productId)
        .query("SELECT * FROM Products WHERE Id = @id");

    req.session.cart.push({
        product: result.recordset[0],
        quantity: 1
    });

    res.redirect('/cart');
});

// VIEW CART
app.get('/cart', (req, res) => {
    res.render('cart', { cart: req.session.cart });
});

// UPDATE CART
app.post('/cart/update', (req, res) => {
    req.session.cart[req.body.index].quantity = parseInt(req.body.quantity);
    res.redirect('/cart');
});

// REMOVE ITEM
app.post('/cart/remove', (req, res) => {
    req.session.cart.splice(req.body.index, 1);
    res.redirect('/cart');
});

// LOGIN
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    let pool = await sql.connect(config);

    let result = await pool.request()
        .input('email', sql.NVarChar, req.body.email)
        .input('password', sql.NVarChar, req.body.password)
        .query("SELECT * FROM Users WHERE Email=@email AND Password=@password");

    if (result.recordset.length > 0) {
        req.session.user = result.recordset[0];
        res.redirect('/');
    } else {
        res.send("Invalid login");
    }
});

// CHECKOUT (SIMULATED PAYMENT)
app.get('/checkout', (req, res) => res.render('checkout'));

app.post('/checkout', async (req, res) => {
    let pool = await sql.connect(config);

    for (let item of req.session.cart) {
        await pool.request()
            .input('userId', sql.Int, req.session.user?.Id || 1)
            .input('productId', sql.Int, item.product.Id)
            .input('quantity', sql.Int, item.quantity)
            .query("INSERT INTO Orders (UserId, ProductId, Quantity) VALUES (@userId, @productId, @quantity)");
    }

    req.session.cart = [];
    res.send("Payment successful! Order placed.");
});

// ADMIN CHECK
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.Role === 'admin') {
        next();
    } else {
        res.send("Access denied");
    }
}

// ADMIN DASHBOARD
app.get('/admin', isAdmin, async (req, res) => {
    let pool = await sql.connect(config);

    let products = await pool.request().query("SELECT * FROM Products");
    let orders = await pool.request().query("SELECT * FROM Orders");

    res.render('admin', {
        products: products.recordset,
        orders: orders.recordset
    });
});

app.listen(process.env.PORT || 3000, () => console.log("Running..."));
