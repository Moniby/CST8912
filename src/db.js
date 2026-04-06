const sql = require("mssql");
const blobBaseUrl = (process.env.AZURE_BLOB_BASE_URL || "").replace(/\/+$/, "");

const demoProducts = [
  {
    Id: 1,
    Name: "Classic Shirt",
    Category: "Shirt",
    Price: 39.99,
    Description: "Comfortable cotton shirt for everyday wear.",
    ImageUrl: "/images/shirt.svg"
  },
  {
    Id: 2,
    Name: "Modern Pants",
    Category: "Pants",
    Price: 59.99,
    Description: "Slim-fit pants with stretch fabric.",
    ImageUrl: "/images/pants.svg"
  },
  {
    Id: 3,
    Name: "Sport Sneakers",
    Category: "Sneakers",
    Price: 89.99,
    Description: "Lightweight sneakers designed for comfort.",
    ImageUrl: "/images/sneakers.svg"
  }
];

function isAzureSqlConfigured() {
  return Boolean(
    process.env.AZURE_SQL_SERVER &&
      process.env.AZURE_SQL_DATABASE &&
      process.env.AZURE_SQL_USER &&
      process.env.AZURE_SQL_PASSWORD
  );
}

function withBlobUrl(imageUrl) {
  if (!imageUrl) {
    return imageUrl;
  }
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://") || !blobBaseUrl) {
    return imageUrl;
  }
  const normalizedPath = imageUrl.startsWith("/") ? imageUrl.slice(1) : imageUrl;
  return `${blobBaseUrl}/${normalizedPath}`;
}

const sqlConfig = {
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  options: {
    encrypt: process.env.AZURE_SQL_ENCRYPT !== "false",
    trustServerCertificate: false
  }
};

let poolPromise;
const demoOrders = [];
let useDemoMode = false;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(sqlConfig)
      .connect()
      .then((pool) => pool)
      .catch((error) => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}

async function initializeDatabase() {
  if (!isAzureSqlConfigured()) {
    useDemoMode = true;
    return false;
  }

  try {
    const pool = await getPool();
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Products' AND xtype='U')
      BEGIN
        CREATE TABLE Products (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Name NVARCHAR(100) NOT NULL,
          Category NVARCHAR(50) NOT NULL,
          Price DECIMAL(10,2) NOT NULL,
          Description NVARCHAR(255) NULL,
          ImageUrl NVARCHAR(255) NULL
        );
      END
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM Products)
      BEGIN
        INSERT INTO Products (Name, Category, Price, Description, ImageUrl)
        VALUES
        ('Classic Shirt', 'Shirt', 39.99, 'Comfortable cotton shirt for everyday wear.', '/images/shirt.svg'),
        ('Modern Pants', 'Pants', 59.99, 'Slim-fit pants with stretch fabric.', '/images/pants.svg'),
        ('Sport Sneakers', 'Sneakers', 89.99, 'Lightweight sneakers designed for comfort.', '/images/sneakers.svg');
      END
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Orders' AND xtype='U')
      BEGIN
        CREATE TABLE Orders (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          CustomerName NVARCHAR(120) NOT NULL,
          CustomerEmail NVARCHAR(120) NOT NULL,
          ShippingAddress NVARCHAR(255) NOT NULL,
          TotalAmount DECIMAL(10,2) NOT NULL,
          CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
      END
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='OrderItems' AND xtype='U')
      BEGIN
        CREATE TABLE OrderItems (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          OrderId INT NOT NULL,
          ProductId INT NOT NULL,
          ProductName NVARCHAR(100) NOT NULL,
          UnitPrice DECIMAL(10,2) NOT NULL,
          Quantity INT NOT NULL,
          CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (OrderId) REFERENCES Orders(Id)
        );
      END
    `);

    await pool.request().query(`
      IF COL_LENGTH('Orders', 'PaymentReference') IS NULL
      BEGIN
        ALTER TABLE Orders ADD PaymentReference NVARCHAR(120) NULL;
      END
    `);

    await pool.request().query(`
      IF COL_LENGTH('Orders', 'PaymentStatus') IS NULL
      BEGIN
        ALTER TABLE Orders ADD PaymentStatus NVARCHAR(30) NULL;
      END
    `);

    useDemoMode = false;
    return true;
  } catch (error) {
    useDemoMode = true;
    poolPromise = null;
    return false;
  }
}

async function getProducts() {
  if (!isAzureSqlConfigured() || useDemoMode) {
    return demoProducts.map((product) => ({
      ...product,
      ImageUrl: withBlobUrl(product.ImageUrl)
    }));
  }

  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT Id, Name, Category, Price, Description, ImageUrl
    FROM Products
    ORDER BY Id
  `);

  return result.recordset.map((product) => ({
    ...product,
    ImageUrl: withBlobUrl(product.ImageUrl)
  }));
}

async function getProductById(id) {
  const productId = Number(id);
  const products = await getProducts();
  return products.find((product) => Number(product.Id) === productId) || null;
}

async function createOrder(customer, items, payment) {
  const totalAmount = items.reduce(
    (sum, item) => sum + Number(item.product.Price) * item.quantity,
    0
  );

  if (!isAzureSqlConfigured() || useDemoMode) {
    const order = {
      Id: demoOrders.length + 1,
      CustomerName: customer.name,
      CustomerEmail: customer.email,
      ShippingAddress: customer.address,
      TotalAmount: Number(totalAmount.toFixed(2)),
      PaymentReference: payment.reference,
      PaymentStatus: payment.status,
      CreatedAt: new Date().toISOString(),
      Items: items.map((item) => ({
        ProductId: Number(item.product.Id),
        ProductName: item.product.Name,
        UnitPrice: Number(item.product.Price),
        Quantity: item.quantity
      }))
    };
    demoOrders.push(order);
    return order.Id;
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const orderRequest = new sql.Request(transaction);
    orderRequest.input("customerName", sql.NVarChar(120), customer.name);
    orderRequest.input("customerEmail", sql.NVarChar(120), customer.email);
    orderRequest.input("shippingAddress", sql.NVarChar(255), customer.address);
    orderRequest.input("totalAmount", sql.Decimal(10, 2), totalAmount);
    orderRequest.input("paymentReference", sql.NVarChar(120), payment.reference);
    orderRequest.input("paymentStatus", sql.NVarChar(30), payment.status);

    const orderResult = await orderRequest.query(`
      INSERT INTO Orders (CustomerName, CustomerEmail, ShippingAddress, TotalAmount, PaymentReference, PaymentStatus)
      OUTPUT INSERTED.Id
      VALUES (@customerName, @customerEmail, @shippingAddress, @totalAmount, @paymentReference, @paymentStatus)
    `);

    const orderId = orderResult.recordset[0].Id;

    for (const item of items) {
      const itemRequest = new sql.Request(transaction);
      itemRequest.input("orderId", sql.Int, orderId);
      itemRequest.input("productId", sql.Int, Number(item.product.Id));
      itemRequest.input("productName", sql.NVarChar(100), item.product.Name);
      itemRequest.input("unitPrice", sql.Decimal(10, 2), Number(item.product.Price));
      itemRequest.input("quantity", sql.Int, item.quantity);

      await itemRequest.query(`
        INSERT INTO OrderItems (OrderId, ProductId, ProductName, UnitPrice, Quantity)
        VALUES (@orderId, @productId, @productName, @unitPrice, @quantity)
      `);
    }

    await transaction.commit();
    return orderId;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function getOrderById(id) {
  const orderId = Number(id);

  if (!isAzureSqlConfigured() || useDemoMode) {
    return demoOrders.find((order) => order.Id === orderId) || null;
  }

  const pool = await getPool();
  const orderResult = await pool.request().input("orderId", sql.Int, orderId).query(`
      SELECT Id, CustomerName, CustomerEmail, ShippingAddress, TotalAmount, PaymentReference, PaymentStatus, CreatedAt
      FROM Orders
      WHERE Id = @orderId
    `);

  if (orderResult.recordset.length === 0) {
    return null;
  }

  const itemsResult = await pool.request().input("orderId", sql.Int, orderId).query(`
      SELECT ProductId, ProductName, UnitPrice, Quantity
      FROM OrderItems
      WHERE OrderId = @orderId
      ORDER BY Id
    `);

  const order = orderResult.recordset[0];
  order.Items = itemsResult.recordset;
  return order;
}

module.exports = {
  initializeDatabase,
  getProducts,
  getProductById,
  createOrder,
  getOrderById
};
