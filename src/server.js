require("dotenv").config();

const path = require("path");
const express = require("express");
const { processPayment } = require("./payment");
const {
  initializeDatabase,
  getProducts,
  getProductById,
  createOrder,
  getOrderById
} = require("./db");

const app = express();
const port = process.env.PORT || 3000;
const carts = new Map();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) {
    return {};
  }

  return raw.split(";").reduce((acc, pair) => {
    const [key, ...valueParts] = pair.trim().split("=");
    acc[key] = decodeURIComponent(valueParts.join("="));
    return acc;
  }, {});
}

function getSessionId(req, res) {
  const cookies = parseCookies(req);
  let sessionId = cookies.sessionId;
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    res.setHeader("Set-Cookie", `sessionId=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return sessionId;
}

function getCartForRequest(req, res) {
  const sessionId = getSessionId(req, res);
  if (!carts.has(sessionId)) {
    carts.set(sessionId, []);
  }
  return carts.get(sessionId);
}

function getCartCount(cart) {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function getCartTotal(cart) {
  return cart.reduce((sum, item) => sum + Number(item.product.Price) * item.quantity, 0);
}

function validateCheckoutForm(form) {
  return Boolean(form.name && form.email && form.address && form.cardNumber && form.expiry && form.cvv);
}

app.get("/", (req, res) => {
  const cart = getCartForRequest(req, res);
  return res.render("home", {
    title: "CST8912 Ecommerce Store Project",
    cartCount: getCartCount(cart)
  });
});

app.get("/home", (req, res) => {
  const cart = getCartForRequest(req, res);
  return res.render("home", {
    title: "CST8912 Ecommerce Store Project",
    cartCount: getCartCount(cart)
  });
});

app.get("/about", (req, res) => {
  const cart = getCartForRequest(req, res);
  return res.render("about", {
    title: "About Us",
    cartCount: getCartCount(cart)
  });
});

app.get("/products", async (req, res) => {
  try {
    const cart = getCartForRequest(req, res);
    const search = (req.query.search || "").toString().trim().toLowerCase();
    const category = (req.query.category || "").toString().trim();

    const allProducts = await getProducts();
    const categories = [...new Set(allProducts.map((product) => product.Category))];
    const products = allProducts.filter((product) => {
      const matchesCategory = !category || product.Category === category;
      const matchesSearch =
        !search ||
        product.Name.toLowerCase().includes(search) ||
        product.Description.toLowerCase().includes(search);
      return matchesCategory && matchesSearch;
    });

    res.render("index", {
      title: "Products",
      products,
      categories,
      selectedCategory: category,
      search,
      cartCount: getCartCount(cart)
    });
  } catch (error) {
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load products from Azure SQL Database.",
      details: error.message
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const products = await getProducts();
    return res.json({ products });
  } catch (error) {
    return res.status(500).json({ error: "Unable to retrieve products." });
  }
});

app.get("/products/:id", async (req, res) => {
  try {
    const cart = getCartForRequest(req, res);
    const product = await getProductById(req.params.id);
    if (!product) {
      return res.status(404).render("error", {
        title: "Product Not Found",
        message: "This product could not be found.",
        details: "Please return to the store and choose another item."
      });
    }

    return res.render("product", {
      title: product.Name,
      product,
      cartCount: getCartCount(cart)
    });
  } catch (error) {
    return res.status(500).render("error", {
      title: "Error",
      message: "Unable to load the product.",
      details: error.message
    });
  }
});

app.post("/cart/add", async (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = Math.max(1, Number(req.body.quantity) || 1);

  try {
    const cart = getCartForRequest(req, res);
    const product = await getProductById(productId);
    if (!product) {
      return res.redirect("/products");
    }

    const existing = cart.find((item) => Number(item.product.Id) === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({ product, quantity });
    }
  } catch (error) {
    return res.status(500).render("error", {
      title: "Cart Error",
      message: "Unable to add item to cart.",
      details: error.message
    });
  }

  return res.redirect("/cart");
});

app.get("/cart", (req, res) => {
  const cart = getCartForRequest(req, res);
  return res.render("cart", {
    title: "Your Cart",
    cart,
    cartCount: getCartCount(cart),
    total: getCartTotal(cart)
  });
});

app.post("/cart/update", (req, res) => {
  const cart = getCartForRequest(req, res);
  const productId = Number(req.body.productId);
  const quantity = Math.max(1, Number(req.body.quantity) || 1);
  const item = cart.find((entry) => Number(entry.product.Id) === productId);
  if (item) {
    item.quantity = quantity;
  }
  return res.redirect("/cart");
});

app.post("/cart/remove", (req, res) => {
  const cart = getCartForRequest(req, res);
  const productId = Number(req.body.productId);
  const updated = cart.filter((entry) => Number(entry.product.Id) !== productId);
  carts.set(getSessionId(req, res), updated);
  return res.redirect("/cart");
});

app.get("/checkout", (req, res) => {
  const cart = getCartForRequest(req, res);
  if (cart.length === 0) {
    return res.redirect("/products");
  }

  return res.render("checkout", {
    title: "Checkout",
    cartCount: getCartCount(cart),
    total: getCartTotal(cart),
    error: null,
    form: { name: "", email: "", address: "", cardNumber: "", expiry: "", cvv: "" }
  });
});

app.post("/checkout", async (req, res) => {
  const cart = getCartForRequest(req, res);
  if (cart.length === 0) {
    return res.redirect("/products");
  }

  const form = {
    name: (req.body.name || "").trim(),
    email: (req.body.email || "").trim(),
    address: (req.body.address || "").trim(),
    cardNumber: (req.body.cardNumber || "").trim(),
    expiry: (req.body.expiry || "").trim(),
    cvv: (req.body.cvv || "").trim()
  };

  if (!validateCheckoutForm(form)) {
    return res.status(400).render("checkout", {
      title: "Checkout",
      cartCount: getCartCount(cart),
      total: getCartTotal(cart),
      error: "Please fill in all customer and payment fields.",
      form
    });
  }

  try {
    const paymentResult = await processPayment({
      cardNumber: form.cardNumber,
      amount: getCartTotal(cart)
    });

    const orderId = await createOrder(form, cart, paymentResult);
    carts.set(getSessionId(req, res), []);
    return res.redirect(`/orders/${orderId}`);
  } catch (error) {
    return res.status(500).render("checkout", {
      title: "Checkout",
      cartCount: getCartCount(cart),
      total: getCartTotal(cart),
      error: `Failed to create order: ${error.message}`,
      form
    });
  }
});

app.post("/api/checkout", async (req, res) => {
  const cart = getCartForRequest(req, res);
  if (cart.length === 0) {
    return res.status(400).json({ error: "Cart is empty." });
  }

  const form = {
    name: (req.body.name || "").trim(),
    email: (req.body.email || "").trim(),
    address: (req.body.address || "").trim(),
    cardNumber: (req.body.cardNumber || "").trim(),
    expiry: (req.body.expiry || "").trim(),
    cvv: (req.body.cvv || "").trim()
  };

  if (!validateCheckoutForm(form)) {
    return res.status(400).json({ error: "Missing required checkout fields." });
  }

  try {
    const paymentResult = await processPayment({
      cardNumber: form.cardNumber,
      amount: getCartTotal(cart)
    });
    const orderId = await createOrder(form, cart, paymentResult);
    carts.set(getSessionId(req, res), []);
    return res.status(201).json({ orderId, paymentReference: paymentResult.reference });
  } catch (error) {
    return res.status(500).json({ error: `Checkout failed: ${error.message}` });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const cart = getCartForRequest(req, res);
    const order = await getOrderById(req.params.id);
    if (!order) {
      return res.status(404).render("error", {
        title: "Order Not Found",
        message: "No order exists with this ID.",
        details: "Please check your order confirmation and try again."
      });
    }

    return res.render("order-success", {
      title: `Order #${order.Id}`,
      order,
      cartCount: getCartCount(cart)
    });
  } catch (error) {
    return res.status(500).render("error", {
      title: "Error",
      message: "Unable to load order details.",
      details: error.message
    });
  }
});

async function start() {
  try {
    await initializeDatabase();
    app.listen(port, () => {
      console.log(`CST8912 Ecommerce Store Project is running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start application:", error.message);
    process.exit(1);
  }
}

start();
