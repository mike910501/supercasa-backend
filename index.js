import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

// 🔐 JWT Secret (en producción, usar variable de entorno)
const JWT_SECRET = 'tu_clave_secreta_super_segura_2024';

// 🧠 Conexión a base de datos Railway
const pool = new Pool({
  connectionString: "postgresql://postgres:tdeuoDrXTBJvFcCnbiehngvItJYFSdtX@gondola.proxy.rlwy.net:50352/railway",
  ssl: { rejectUnauthorized: false }
});

// ✅ Crear tabla usuarios
pool.query(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255), -- ✅ CORREGIDO: Ya no es NOT NULL
    telefono VARCHAR(20),
    direccion TEXT,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rol VARCHAR(20) DEFAULT 'cliente'
  )
`).then(() => console.log("✅ Tabla 'usuarios' lista"))
  .catch(err => console.error("❌ Error creando tabla usuarios:", err));

// ✅ Crear tabla product
pool.query(`
  CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    precio NUMERIC,
    descripcion TEXT,
    nutricional TEXT,
    categoria TEXT,
    imagen TEXT
  )
`).then(() => console.log("✅ Tabla 'productos' lista"))
  .catch(err => console.error("❌ Error creando tabla productos:", err));

// ✅ Crear tabla pedidos mejorada (con usuario_id)
pool.query(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id),
    productos JSONB NOT NULL,
    total INTEGER NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(20) DEFAULT 'pendiente',
    direccion_envio TEXT,
    telefono_contacto VARCHAR(20)
  )
`).then(() => console.log("✅ Tabla 'pedidos' lista"))
  .catch(err => console.error("❌ Error creando tabla pedidos:", err));

// ✅ CORREGIDO: Hacer password opcional
pool.query(`
  ALTER TABLE usuarios 
  ALTER COLUMN password DROP NOT NULL
`).then(() => console.log("✅ Campo password ahora es opcional"))
  .catch(err => console.log("ℹ️ Ya es opcional:", err.message));

// ✅ Actualizar tabla usuarios para incluir datos residenciales (Torres 1,2,3,4,5)
pool.query(`
  ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS torre VARCHAR(1),
  ADD COLUMN IF NOT EXISTS piso INTEGER CHECK (piso >= 1 AND piso <= 30),
  ADD COLUMN IF NOT EXISTS apartamento VARCHAR(10),
  ADD COLUMN IF NOT EXISTS telefono_alternativo VARCHAR(20),
  ADD COLUMN IF NOT EXISTS notas_entrega TEXT,
  ADD COLUMN IF NOT EXISTS cedula VARCHAR(20) UNIQUE
`).then(async () => {
  try {
    await pool.query(`
      ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_torre_check;
      ALTER TABLE usuarios ADD CONSTRAINT usuarios_torre_check 
      CHECK (torre IN ('1', '2', '3', '4', '5'));
    `);
    console.log("✅ Tabla usuarios actualizada para conjunto residencial (Torres 1-5)");
  } catch (err) {
    console.log("ℹ️ Constraint torre ya existe o error:", err.message);
  }
}).catch(err => console.log("ℹ️ Columnas ya existen o error:", err.message));

// ✅ CORREGIDO: Actualizar tabla productos para incluir STOCK y CÓDIGO
pool.query(`
  ALTER TABLE productos 
  ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(20) UNIQUE
`).then(() => console.log("✅ Campos stock y codigo agregados a productos"))
  .catch(err => console.log("ℹ️ Campos ya existen:", err.message));

// ✅ Actualizar tabla pedidos para entrega residencial (Torres 1,2,3,4,5)
pool.query(`
  ALTER TABLE pedidos 
  ADD COLUMN IF NOT EXISTS torre_entrega VARCHAR(1),
  ADD COLUMN IF NOT EXISTS piso_entrega INTEGER CHECK (piso_entrega >= 1 AND piso_entrega <= 30),
  ADD COLUMN IF NOT EXISTS apartamento_entrega VARCHAR(10),
  ADD COLUMN IF NOT EXISTS instrucciones_entrega TEXT,
  ADD COLUMN IF NOT EXISTS horario_preferido VARCHAR(50),
  ADD COLUMN IF NOT EXISTS entregado_por VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fecha_entrega TIMESTAMP
`).then(async () => {
  try {
    await pool.query(`
      ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_torre_entrega_check;
      ALTER TABLE pedidos ADD CONSTRAINT pedidos_torre_entrega_check 
      CHECK (torre_entrega IN ('1', '2', '3', '4', '5'));
    `);
    console.log("✅ Tabla pedidos actualizada para entrega residencial (Torres 1-5)");
  } catch (err) {
    console.log("ℹ️ Constraint torre_entrega ya existe o error:", err.message);
  }
}).catch(err => console.log("ℹ️ Columnas ya existen o error:", err.message));

// ✅ CORREGIDO: Agregar campos de pago WOMPI a tabla pedidos
pool.query(`
  ALTER TABLE pedidos 
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS payment_transaction_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payment_amount_cents INTEGER
`).then(() => console.log("✅ Campos de pago WOMPI agregados"))
  .catch(err => console.log("ℹ️ Campos ya existen:", err.message));

// ⚡ Función de validación para datos residenciales
function validarDatosResidenciales(torre, piso, apartamento) {
  const errores = [];

  if (!['1', '2', '3', '4', '5'].includes(String(torre))) {
    errores.push('Torre debe ser 1, 2, 3, 4 o 5');
  }

  const pisoNum = parseInt(piso);
  if (!piso || pisoNum < 1 || pisoNum > 30) {
    errores.push('El piso debe estar entre 1 y 30');
  }

  if (!apartamento || apartamento.length === 0) {
    errores.push('El apartamento es obligatorio');
  }

  return errores;
}

// 🛡️ Middleware de autenticación con mensajes amigables
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Su sesión ha expirado. Por favor inicie sesión nuevamente.',
      action: 'LOGIN_REQUIRED'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        error: 'Su sesión ha expirado. Por favor inicie sesión nuevamente.',
        action: 'SESSION_EXPIRED'
      });
    }
    req.user = user;
    next();
  });
};

// 🛡️ Middleware para admin
const requireAdmin = (req, res, next) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador' });
  }
  next();
};

// ===================
// 🔐 RUTAS DE AUTENTICACIÓN
// ===================

// 📝 Registro de usuario SIN CONTRASEÑA - ✅ CORREGIDO
app.post('/auth/register', async (req, res) => {
  const { 
    nombre, 
    email, 
    cedula,
    telefono, 
    telefono_alternativo,
    torre, 
    piso, 
    apartamento,
    notas_entrega 
  } = req.body;

  try {
    const erroresValidacion = validarDatosResidenciales(torre, piso, apartamento);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({ error: erroresValidacion.join(', ') });
    }

    if (!nombre || !email || !cedula || !telefono) {
      return res.status(400).json({ error: 'Nombre, email, cédula y teléfono son obligatorios' });
    }

    // ✅ CORREGIDO: Normalizar email
    const emailNormalizado = email.trim().toLowerCase();

    const emailExists = await pool.query('SELECT id FROM usuarios WHERE email = $1', [emailNormalizado]);
    if (emailExists.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    const cedulaExists = await pool.query('SELECT id FROM usuarios WHERE cedula = $1', [cedula]);
    if (cedulaExists.rows.length > 0) {
      return res.status(400).json({ error: 'La cédula ya está registrada' });
    }

    const result = await pool.query(
      `INSERT INTO usuarios (
        nombre, email, cedula, telefono, telefono_alternativo, 
        torre, piso, apartamento, notas_entrega
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
      RETURNING id, nombre, email, cedula, telefono, torre, piso, apartamento, rol`,
      [nombre, emailNormalizado, cedula, telefono, telefono_alternativo, torre, piso, apartamento, notas_entrega]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        rol: user.rol 
      }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        cedula: user.cedula,
        telefono: user.telefono,
        torre: user.torre,
        piso: user.piso,
        apartamento: user.apartamento,
        direccion: `Torre ${user.torre}, Piso ${user.piso}, Apt ${user.apartamento}`,
        rol: user.rol
      }
    });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🔑 Login de usuario SIN CONTRASEÑA - ✅ CORREGIDO
app.post('/auth/login', async (req, res) => {
  const { email, cedula, telefono } = req.body;

  try {
    if (!email || !cedula || !telefono) {
      return res.status(400).json({ error: 'Email, cédula y teléfono son obligatorios' });
    }

    // ✅ CORREGIDO: Normalizar email en login también
    const emailNormalizado = email.trim().toLowerCase();

    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND cedula = $2 AND telefono = $3', 
      [emailNormalizado, cedula.trim(), telefono.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Los datos ingresados no coinciden con ningún usuario registrado' });
    }

    const user = result.rows[0];

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        rol: user.rol 
      }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        cedula: user.cedula,
        telefono: user.telefono,
        torre: user.torre,
        piso: user.piso,
        apartamento: user.apartamento,
        direccion: user.torre && user.piso && user.apartamento 
          ? `Torre ${user.torre}, Piso ${user.piso}, Apt ${user.apartamento}` 
          : user.direccion,
        notas_entrega: user.notas_entrega,
        rol: user.rol
      }
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 👤 Obtener perfil del usuario
app.get('/auth/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre, email, telefono, direccion, rol, fecha_registro FROM usuarios WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Error obteniendo perfil:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ✏️ Actualizar perfil del usuario
app.put('/auth/profile', authenticateToken, async (req, res) => {
  const { nombre, telefono, direccion } = req.body;

  try {
    await pool.query(
      'UPDATE usuarios SET nombre = $1, telefono = $2, direccion = $3 WHERE id = $4',
      [nombre, telefono, direccion, req.user.userId]
    );

    res.json({ success: true, message: 'Perfil actualizado exitosamente' });
  } catch (err) {
    console.error('Error actualizando perfil:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ===================
// 📦 RUTAS DE PRODUCTOS
// ===================

// 📥 Crear producto (solo admin)
app.post('/productos', authenticateToken, requireAdmin, async (req, res) => {
  const { nombre, precio, descripcion, nutricional, categoria, imagen, stock, codigo } = req.body;
  try {
    await pool.query(
      'INSERT INTO productos (nombre, precio, descripcion, nutricional, categoria, imagen, stock, codigo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [nombre, precio, descripcion, nutricional, categoria, imagen, stock || 0, codigo]
    );
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// 📤 Obtener productos (público)
app.get('/productos', async (_, res) => {
  try {
    const result = await pool.query('SELECT * FROM productos ORDER BY id DESC');
    res.send(result.rows);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// 🆕 NUEVO: Buscar productos por categoría/nombre para Luna
app.get('/productos/buscar/:termino', async (req, res) => {
  try {
    const { termino } = req.params;
    
    console.log('🔍 Luna buscando productos:', termino);
    
    const result = await pool.query(`
      SELECT id, nombre, precio, categoria, stock, codigo
      FROM productos 
      WHERE (
        LOWER(nombre) LIKE LOWER($1) OR 
        LOWER(categoria) LIKE LOWER($1)
      ) AND stock > 0
      ORDER BY stock DESC, precio ASC
      LIMIT 5
    `, [`%${termino}%`]);
    
    res.json({
      encontrados: result.rows.length > 0,
      productos: result.rows,
      cantidad: result.rows.length,
      termino_buscado: termino
    });
    
  } catch (error) {
    console.error('❌ Error buscando productos:', error);
    res.status(500).json({ 
      encontrados: false, 
      productos: [], 
      cantidad: 0,
      error: 'Error interno del servidor' 
    });
  }
});

// 🗑️ Eliminar producto (solo admin)
app.delete('/productos/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM productos WHERE id = $1', [id]);
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// ✏️ Actualizar producto (solo admin)
app.put('/productos/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nombre, precio, descripcion, nutricional, categoria, imagen, stock, codigo } = req.body;

  try {
    await pool.query(
      'UPDATE productos SET nombre = $1, precio = $2, descripcion = $3, nutricional = $4, categoria = $5, imagen = $6, stock = $7, codigo = $8 WHERE id = $9',
      [nombre, precio, descripcion, nutricional, categoria, imagen, stock || 0, codigo, id]
    );
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// ===================
// 🛍️ RUTAS DE PEDIDOS
// ===================

// 🛍️ Crear pedido con CONTROL DE STOCK + CÓDIGOS
app.post('/orders', authenticateToken, async (req, res) => {
  const { 
    productos, 
    total, 
    torre_entrega, 
    piso_entrega, 
    apartamento_entrega,
    instrucciones_entrega,
    telefono_contacto,
    payment_reference,
    payment_status = 'PENDING',
    payment_method,
    payment_transaction_id,
    payment_amount_cents
  } = req.body;

  try {
    const erroresValidacion = validarDatosResidenciales(torre_entrega, piso_entrega, apartamento_entrega);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({ error: `Datos de entrega: ${erroresValidacion.join(', ')}` });
    }

    if (!productos || productos.length === 0) {
      return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
    }

    if (!telefono_contacto) {
      return res.status(400).json({ error: 'El teléfono de contacto es obligatorio' });
    }

    const totalInt = Math.round(Number(total));

    if (isNaN(totalInt) || totalInt <= 0) {
      console.error('🚫 totalPedido inválido:', total);
      return res.status(400).json({ error: 'Total no válido' });
    }

    if (payment_reference) {
      const existingOrder = await pool.query(
        'SELECT id FROM pedidos WHERE payment_reference = $1',
        [payment_reference]
      );
      if (existingOrder.rows.length > 0) {
        return res.status(400).json({
          error: 'Ya existe un pedido con esta referencia de pago'
        });
      }
    }

    // ✅ VERIFICAR STOCK Y OBTENER CÓDIGOS
    console.log('🔍 Verificando stock de productos...');
    const erroresStock = [];
    const productosConCodigo = []; // 🎯 NUEVO: Array para productos con código
    
    for (const item of productos) {
      const stockQuery = await pool.query(
        'SELECT id, nombre, stock, codigo FROM productos WHERE id = $1', // 🎯 AGREGADO: codigo
        [item.id]
      );
      
      if (stockQuery.rows.length === 0) {
        erroresStock.push(`Producto ID ${item.id} no encontrado`);
        continue; // ✅ DENTRO del for loop
      }
      
      const producto = stockQuery.rows[0];
      const stockDisponible = producto.stock || 0;
      const cantidadSolicitada = item.cantidad || 1;
      
      if (stockDisponible < cantidadSolicitada) {
        erroresStock.push(`${producto.nombre}: Stock insuficiente (disponible: ${stockDisponible}, solicitado: ${cantidadSolicitada})`);
      }
      
      // 🎯 NUEVO: Agregar producto con código
      productosConCodigo.push({
        id: item.id,
        nombre: producto.nombre,
        precio: item.precio,
        cantidad: item.cantidad,
        codigo: producto.codigo // 🎯 AGREGAR CÓDIGO
      });
    }
    
    if (erroresStock.length > 0) {
      console.log('❌ Errores de stock:', erroresStock);
      return res.status(400).json({ 
        error: 'Stock insuficiente', 
        detalles: erroresStock 
      });
    }

    console.log('✅ Stock verificado correctamente');

    const result = await pool.query(
      `INSERT INTO pedidos (
        usuario_id, productos, total, 
        torre_entrega, piso_entrega, apartamento_entrega,
        instrucciones_entrega, telefono_contacto,
        payment_reference, payment_status, payment_method,
        payment_transaction_id, payment_amount_cents
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        req.user.userId, 
        JSON.stringify(productosConCodigo), // 🎯 USAR PRODUCTOS CON CÓDIGO
        totalInt,
        torre_entrega,
        piso_entrega, 
        apartamento_entrega,
        instrucciones_entrega,
        telefono_contacto,
        payment_reference,
        payment_status,
        payment_method,
        payment_transaction_id,
        payment_amount_cents
      ]
    );

    console.log('✅ Pedido creado exitosamente:', {
      id: result.rows[0].id,
      usuario_id: req.user.userId,
      total: totalInt,
      payment_reference,
      piso_entrega: parseInt(piso_entrega)
    });

    // ✅ REDUCIR STOCK DESPUÉS DE CREAR PEDIDO EXITOSO
    console.log('📦 Reduciendo stock de productos...');
    
    for (const item of productos) {
      const cantidadSolicitada = item.cantidad || 1;
      
      await pool.query(
        'UPDATE productos SET stock = GREATEST(stock - $1, 0) WHERE id = $2',
        [cantidadSolicitada, item.id]
      );
      
      console.log(`📉 Stock reducido: Producto ID ${item.id}, cantidad: ${cantidadSolicitada}`);
    }

    console.log('✅ Stock actualizado correctamente');

    res.json({ 
      success: true, 
      message: 'Pedido creado exitosamente - Entrega en máximo 20 minutos',
      pedidoId: result.rows[0].id,
      entrega: `Torre ${torre_entrega}, Piso ${piso_entrega}, Apt ${apartamento_entrega}`,
      tiempoEstimado: '20 minutos máximo',
      pedido: result.rows[0]
    });
  } catch (err) {
    console.error('❌ Error guardando pedido:', err);
    res.status(500).json({ error: 'Error guardando pedido' });
  }
});

// 📄 Obtener pedidos con información de entrega
app.get('/orders', authenticateToken, async (req, res) => {
  try {
    let query, params;
    
    if (req.user.rol === 'admin') {
      query = `
        SELECT 
          p.*,
          u.nombre as usuario_nombre, 
          u.email as usuario_email,
          u.telefono as usuario_telefono,
          CONCAT('Torre ', p.torre_entrega, ', Piso ', p.piso_entrega, ', Apt ', p.apartamento_entrega) as direccion_completa
        FROM pedidos p 
        LEFT JOIN usuarios u ON p.usuario_id = u.id 
        ORDER BY p.fecha DESC
      `;
      params = [];
    } else {
      query = `
        SELECT 
          *,
          CONCAT('Torre ', torre_entrega, ', Piso ', piso_entrega, ', Apt ', apartamento_entrega) as direccion_completa
        FROM pedidos 
        WHERE usuario_id = $1 
        ORDER BY fecha DESC
      `;
      params = [req.user.userId];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo pedidos:', err);
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

// 💳 Actualizar información de pago
app.put('/orders/:id/payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      payment_status,
      payment_transaction_id,
      payment_method,
      payment_amount_cents
    } = req.body;

    const pedidoCheck = await pool.query(
      'SELECT usuario_id FROM pedidos WHERE id = $1',
      [id]
    );

    if (pedidoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const esPropioPedido = pedidoCheck.rows[0].usuario_id === req.user.userId;
    const esAdmin = req.user.rol === 'admin';

    if (!esPropioPedido && !esAdmin) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar este pedido' });
    }

    const updateQuery = `
      UPDATE pedidos 
      SET 
        payment_status = COALESCE($1, payment_status),
        payment_transaction_id = COALESCE($2, payment_transaction_id),
        payment_method = COALESCE($3, payment_method),
        payment_amount_cents = COALESCE($4, payment_amount_cents)
      WHERE id = $5 
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      payment_status,
      payment_transaction_id,
      payment_method,
      payment_amount_cents,
      id
    ]);

    res.json({
      message: 'Información de pago actualizada',
      pedido: result.rows[0]
    });

  } catch (error) {
    console.error('Error al actualizar pago:', error);
    res.status(500).json({ error: 'Error al actualizar información de pago' });
  }
});

// ✏️ Actualizar estado de un pedido (solo admin)
app.put('/orders/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  try {
    if (!['pendiente', 'procesando', 'enviado', 'entregado', 'cancelado'].includes(estado.toLowerCase())) {
      return res.status(400).json({ error: 'Estado no válido' });
    }

    const fechaEntrega = estado.toLowerCase() === 'entregado' ? new Date() : null;
    
    await pool.query(
      'UPDATE pedidos SET estado = $1, fecha_entrega = $2 WHERE id = $3',
      [estado.toLowerCase(), fechaEntrega, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al actualizar estado del pedido:', err);
    res.status(500).json({ error: 'Error al actualizar estado del pedido' });
  }
});

// ✏️ Marcar pedido como entregado (solo admin)
app.put('/orders/:id/entrega', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { entregado_por, notas_entrega } = req.body;

  try {
    await pool.query(
      `UPDATE pedidos SET 
        estado = 'entregado',
        fecha_entrega = CURRENT_TIMESTAMP,
        entregado_por = $2,
        instrucciones_entrega = COALESCE(instrucciones_entrega, '') || ' | Entrega: ' || $3
      WHERE id = $1`,
      [id, entregado_por, notas_entrega || 'Entregado correctamente en máximo 20 minutos']
    );

    res.json({ success: true, message: 'Pedido marcado como entregado' });
  } catch (err) {
    console.error('❌ Error actualizando entrega:', err);
    res.status(500).json({ error: 'Error actualizando entrega' });
  }
});

// ===================
// 👥 RUTAS DE ADMINISTRACIÓN
// ===================

// 📊 Dashboard de admin - estadísticas
app.get('/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) as total_usuarios FROM usuarios'),
      pool.query('SELECT COUNT(*) as total_productos FROM productos'),
      pool.query('SELECT COUNT(*) as total_pedidos FROM pedidos'),
      pool.query('SELECT SUM(total) as ingresos_totales FROM pedidos WHERE estado != $1', ['cancelado']),
      pool.query('SELECT COUNT(*) as pedidos_pendientes FROM pedidos WHERE estado = $1', ['pendiente']),
      pool.query('SELECT COUNT(*) as pagos_aprobados FROM pedidos WHERE payment_status = $1', ['APPROVED']),
      // ✅ NUEVO: Estadísticas de inventario
      pool.query('SELECT COUNT(*) as productos_sin_stock FROM productos WHERE stock = 0'),
      pool.query('SELECT COUNT(*) as productos_stock_bajo FROM productos WHERE stock > 0 AND stock <= 5'),
      pool.query('SELECT SUM(stock) as stock_total FROM productos')
    ]);

    res.json({
      totalUsuarios: parseInt(stats[0].rows[0].total_usuarios),
      totalProductos: parseInt(stats[1].rows[0].total_productos),
      totalPedidos: parseInt(stats[2].rows[0].total_pedidos),
      ingresosTotales: parseInt(stats[3].rows[0].ingresos_totales) || 0,
      pedidosPendientes: parseInt(stats[4].rows[0].pedidos_pendientes),
      pagosAprobados: parseInt(stats[5].rows[0].pagos_aprobados),
      // ✅ NUEVO: Estadísticas de inventario
      productosSinStock: parseInt(stats[6].rows[0].productos_sin_stock),
      productosStockBajo: parseInt(stats[7].rows[0].productos_stock_bajo),
      stockTotal: parseInt(stats[8].rows[0].stock_total) || 0
    });
  } catch (err) {
    console.error('Error obteniendo estadísticas:', err);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// 👥 Obtener todos los usuarios (solo admin)
app.get('/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre, email, telefono, direccion, rol, fecha_registro, torre, piso, apartamento, cedula FROM usuarios ORDER BY fecha_registro DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo usuarios:', err);
    res.status(500).json({ error: 'Error obteniendo usuarios' });
  }
});

// 📊 Estadísticas específicas para conjunto residencial
app.get('/admin/stats/residential', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query(`
        SELECT torre_entrega, COUNT(*) as pedidos, SUM(total) as ventas
        FROM pedidos 
        WHERE torre_entrega IS NOT NULL
        GROUP BY torre_entrega
        ORDER BY torre_entrega
      `),
      pool.query(`
        SELECT piso_entrega, COUNT(*) as pedidos
        FROM pedidos 
        WHERE piso_entrega IS NOT NULL
        GROUP BY piso_entrega
        ORDER BY pedidos DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT torre_entrega, COUNT(*) as pendientes
        FROM pedidos 
        WHERE estado = 'pendiente' AND torre_entrega IS NOT NULL
        GROUP BY torre_entrega
      `),
      pool.query(`
        SELECT torre, COUNT(*) as usuarios
        FROM usuarios 
        WHERE torre IS NOT NULL
        GROUP BY torre
        ORDER BY torre
      `)
    ]);

    res.json({
      pedidosPorTorre: stats[0].rows,
      pisosActivos: stats[1].rows,
      entregasPendientes: stats[2].rows,
      usuariosPorTorre: stats[3].rows
    });
  } catch (err) {
    console.error('Error obteniendo estadísticas residenciales:', err);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// ===================
// 🚀 RUTAS PARA GESTIÓN DE PEDIDOS
// ===================

// 📦 Obtener todos los pedidos para gestión admin
app.get('/api/admin/pedidos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { torre, estado } = req.query;

    let query = `
      SELECT 
        p.*,
        u.nombre as usuario_nombre,
        u.email as usuario_email,
        u.telefono
      FROM pedidos p
      JOIN usuarios u ON p.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (torre && ['1', '2', '3', '4', '5'].includes(torre)) {
      query += ` AND p.torre_entrega = $${params.length + 1}`;
      params.push(torre);
    }

    if (estado) {
      query += ` AND p.estado = $${params.length + 1}`;
      params.push(estado);
    }

    query += ` ORDER BY p.fecha DESC`;
    
    const result = await pool.query(query, params);
    
    const pedidosFormateados = result.rows.map(pedido => ({
      id: pedido.id,
      numero_pedido: `SUP-${pedido.id.toString().padStart(3, '0')}`,
      usuario: {
        id: pedido.usuario_id,
        nombre: pedido.usuario_nombre,
        email: pedido.usuario_email,
        telefono: pedido.telefono
      },
      productos: typeof pedido.productos === 'string' 
        ? JSON.parse(pedido.productos) 
        : pedido.productos,
      total: parseFloat(pedido.total),
      estado: pedido.estado,
      fecha_pedido: pedido.fecha,
      fecha_entrega: pedido.fecha_entrega,
      torre_entrega: pedido.torre_entrega,
      piso_entrega: pedido.piso_entrega,
      apartamento_entrega: pedido.apartamento_entrega,
      instrucciones_entrega: pedido.instrucciones_entrega,
      horario_preferido: pedido.horario_preferido,
      telefono_contacto: pedido.telefono_contacto,
      payment_reference: pedido.payment_reference,
      payment_status: pedido.payment_status,
      payment_method: pedido.payment_method,
      payment_transaction_id: pedido.payment_transaction_id,
      payment_amount_cents: pedido.payment_amount_cents
    }));
    
    res.json(pedidosFormateados);
    
  } catch (error) {
    console.error('Error al obtener pedidos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🔄 Actualizar estado del pedido + RESTAURAR STOCK
app.put('/api/admin/pedidos/:id/estado', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    
    const estadosValidos = ['pendiente', 'entregado', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }

    const pedidoQuery = await pool.query(
      'SELECT productos FROM pedidos WHERE id = $1',
      [id]
    );
    
    if (pedidoQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const fechaEntrega = estado === 'entregado' ? new Date() : null;
    
    const result = await pool.query(
      'UPDATE pedidos SET estado = $1, fecha_entrega = $2 WHERE id = $3 RETURNING *',
      [estado, fechaEntrega, id]
    );

    // ✅ RESTAURAR STOCK SI SE CANCELA
    if (estado === 'cancelado') {
      console.log('🔄 Restaurando stock por cancelación...');
      
      const productosData = pedidoQuery.rows[0].productos;
      const productos = typeof productosData === 'string' 
        ? JSON.parse(productosData) 
        : productosData;
      
      for (const item of productos) {
        const cantidadARestaurar = item.cantidad || 1;
        
        await pool.query(
          'UPDATE productos SET stock = stock + $1 WHERE id = $2',
          [cantidadARestaurar, item.id]
        );
        
        console.log(`📈 Stock restaurado: Producto ID ${item.id}, cantidad: +${cantidadARestaurar}`);
      }
      
      console.log('✅ Stock restaurado completamente');
    }
    
    res.json({ 
      message: 'Estado actualizado correctamente',
      pedido: result.rows[0] 
    });
    
  } catch (error) {
    console.error('Error al actualizar estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
// ✅ WEBHOOK WOMPI INTELIGENTE - REEMPLAZAR COMPLETAMENTE
app.post('/webhook/wompi', express.json(), async (req, res) => {
  try {
    console.log('🔔 Webhook WOMPI recibido');
    
    let event;
    if (typeof req.body === 'string') {
      event = JSON.parse(req.body);
    } else {
      event = req.body;
    }
    
    if (event.event === 'transaction.updated') {
      const transaction = event.data.transaction;
      const status = transaction.status;
      const reference = transaction.reference;
      const transactionId = transaction.id;
      
      console.log(`📦 Procesando transacción ${transactionId} - Estado: ${status}`);
      
      // Buscar pedido existente
      const pedidoResult = await pool.query(
        'SELECT id, productos FROM pedidos WHERE payment_reference = $1 OR payment_transaction_id = $2',
        [reference, transactionId]
      );
      
      if (pedidoResult.rows.length === 0 && status === 'APPROVED') {
        console.log(`🚨 PEDIDO NO ENCONTRADO - Creando desde webhook para transacción ${transactionId}`);
        
        // ✅ CREAR PEDIDO DESDE WEBHOOK
        try {
          // Buscar usuario por email (usando el email de la transacción)
          const userResult = await pool.query(
            'SELECT id, nombre, torre, piso, apartamento FROM usuarios WHERE email = $1',
            [transaction.customer_email]
          );
          
          if (userResult.rows.length > 0) {
            const usuario = userResult.rows[0];
            
            // Crear pedido básico desde webhook
            const pedidoWebhook = await pool.query(
              `INSERT INTO pedidos (
                usuario_id, productos, total, 
                torre_entrega, piso_entrega, apartamento_entrega,
                telefono_contacto, payment_reference, payment_status,
                payment_method, payment_transaction_id, payment_amount_cents, estado
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
              RETURNING id`,
              [
                usuario.id,
                JSON.stringify([{
                  id: 'webhook',
                  nombre: 'Producto desde webhook',
                  cantidad: 1,
                  precio: transaction.amount_in_cents / 100
                }]),
                transaction.amount_in_cents / 100,
                usuario.torre,
                usuario.piso, 
                usuario.apartamento,
                'N/A',
                reference,
                'APPROVED',
                transaction.payment_method_type,
                transactionId,
                transaction.amount_in_cents,
                'Pendiente'
              ]
            );
            
            console.log(`✅ Pedido ${pedidoWebhook.rows[0].id} creado desde webhook para usuario ${usuario.nombre}`);
            
          } else {
            console.log(`❌ Usuario no encontrado para email ${transaction.customer_email}`);
          }
          
        } catch (createError) {
          console.error('❌ Error creando pedido desde webhook:', createError);
        }
        
      } else if (pedidoResult.rows.length > 0) {
        // Actualizar pedido existente
        const pedido = pedidoResult.rows[0];
        
        if (status === 'APPROVED') {
          await pool.query(
            `UPDATE pedidos SET 
              payment_status = 'APPROVED',
              payment_transaction_id = $1,
              estado = 'pendiente'
            WHERE id = $2`,
            [transactionId, pedido.id]
          );
          
          console.log(`✅ Pedido ${pedido.id} actualizado como APROBADO vía webhook`);
          
        } else if (status === 'DECLINED') {
          await pool.query(
            'UPDATE pedidos SET payment_status = $1, estado = $2 WHERE id = $3',
            ['DECLINED', 'cancelado', pedido.id]
          );
          
          console.log(`❌ Pedido ${pedido.id} marcado como RECHAZADO vía webhook`);
        }
      }
    }
    
    res.status(200).json({ 
      message: 'Webhook procesado exitosamente',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// ✅ ENDPOINT VERIFICACIÓN CORREGIDO - REEMPLAZAR COMPLETAMENTE
app.get('/api/verificar-pago/:transactionId', authenticateToken, async (req, res) => {
  const { transactionId } = req.params;
  
  try {
    console.log(`🔍 Verificando transacción: ${transactionId}`);
    
    // ✅ BÚSQUEDA MÁS AMPLIA - incluir reference también
    const pedidoLocal = await pool.query(
      'SELECT * FROM pedidos WHERE payment_transaction_id = $1 OR payment_reference = $1 OR payment_reference LIKE $2',
      [transactionId, `%${transactionId}%`]
    );
    
    if (pedidoLocal.rows.length > 0) {
      const pedido = pedidoLocal.rows[0];
      console.log(`✅ Pedido encontrado en BD: ${pedido.id}, estado: ${pedido.payment_status}`);
      
      if (pedido.payment_status === 'APPROVED') {
        return res.json({
          status: 'APPROVED',
          message: 'Pago confirmado en base de datos',
          pedidoId: pedido.id,
          reference: pedido.payment_reference
        });
      }
    }
    
    // ✅ ESPERAR MÁS TIEMPO AL WEBHOOK (hasta 30 segundos)
    console.log('⏳ Pedido no encontrado, esperando webhook...');
    
    let intentos = 0;
    while (intentos < 15) { // 15 intentos x 2 segundos = 30 segundos
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pedidoCreado = await pool.query(
        'SELECT * FROM pedidos WHERE payment_transaction_id = $1 OR payment_reference = $1',
        [transactionId]
      );
      
      if (pedidoCreado.rows.length > 0) {
        const pedido = pedidoCreado.rows[0];
        console.log(`✅ Webhook creó pedido: ${pedido.id}`);
        return res.json({
          status: 'APPROVED',
          message: 'Pago confirmado y pedido creado por webhook',
          pedidoId: pedido.id,
          reference: pedido.payment_reference
        });
      }
      
      intentos++;
      console.log(`⏳ Esperando webhook... ${intentos}/15`);
    }
    
    // ✅ SI NO ENCUENTRA NADA, CONSULTAR WOMPI COMO BACKUP
    const wompiResponse = await fetch(
      `https://api.wompi.co/v1/transactions/${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (wompiResponse.ok) {
      const wompiData = await wompiResponse.json();
      const status = wompiData.data?.status;
      
      res.json({
        status: status || 'PENDING',
        message: status === 'APPROVED' ? 'Pago confirmado pero pedido no encontrado' : 'En proceso',
        reference: wompiData.data?.reference
      });
    } else {
      res.json({ status: 'PENDING', message: 'Verificando...' });
    }
    
  } catch (error) {
    console.error('❌ Error verificando pago:', error);
    res.status(500).json({ status: 'ERROR', message: 'Error verificando pago' });
  }
});

// ===================
// 💬 CHAT CON CHATGPT
// ===================

// 💬 Endpoint para chat con ChatGPT
app.post('/chat', async (req, res) => {
  try {
    const { mensaje, historial = [] } = req.body;

    if (!mensaje || mensaje.trim() === '') {
      return res.status(400).json({ error: 'Mensaje es requerido' });
    }

    const systemPrompt = `Eres el asistente de Supercasa, un e-commerce para conjunto residencial en Colombia.

INFORMACIÓN CLAVE:
- Entrega máximo 20 minutos dentro del conjunto
- Pagos: Nequi, PSE, tarjetas de crédito/débito y efectivo
- Horario: 7AM a 10PM todos los días
- Torres: 1, 2, 3, 4, 5 (pisos 1-30)
- Productos: mercado, aseo, bebidas, snacks
- Sin costo de domicilio dentro del conjunto

INSTRUCCIONES:
- Respuestas cortas y amigables (máximo 2 líneas)
- Usa emojis cuando sea apropiado
- Si preguntan por productos específicos, recomienda usar el buscador
- Para pedidos, guía hacia el carrito
- Siempre menciona la entrega rápida de 20 minutos
- Si no sabes algo específico, sé honesto pero mantén el tono amigable

🚨 IMPORTANTE - CONSULTAS DE PEDIDOS:
- NUNCA inventes información sobre pedidos específicos (SUP-123, etc.)
- Si preguntan por pedidos específicos, di: "Para consultar pedidos específicos, usa el botón 'Mi Historial' o dime el número exacto"
- NO digas que verificarás pedidos, el sistema ya lo maneja automáticamente
- NO inventes estados, tiempos de entrega o información de pedidos

EJEMPLOS:
- "¿Qué productos tienen?" → "Tenemos productos de mercado, aseo, bebidas y snacks 🛒 Usa el buscador para encontrar algo específico. ¡Entrega en máximo 20 minutos!"
- "¿Cuánto cuesta el domicilio?" → "¡El domicilio es GRATIS dentro del conjunto! 🚀 Solo pagas los productos."
- "¿Cómo pago?" → "Aceptamos Nequi, PSE, tarjetas y efectivo 💳 El pago es súper fácil y seguro."`;

    // 🧠 CONSTRUIR CONTEXTO DE CONVERSACIÓN
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Agregar historial reciente (máximo últimos 6 mensajes)
    const historialReciente = historial.slice(-6);
    historialReciente.forEach(msg => {
      messages.push({
        role: msg.de === 'usuario' ? 'user' : 'assistant',
        content: msg.texto
      });
    });

    // Agregar mensaje actual
    messages.push({
      role: 'user',
      content: mensaje
    });

    console.log('🤖 Enviando a ChatGPT:', {
      mensajes: messages.length,
      ultimoMensaje: mensaje
    });

    // 🌐 LLAMADA A OPENAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: messages,
        max_tokens: 150,
        temperature: 0.7,
        presence_penalty: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Error OpenAI:', error);
      throw new Error(`OpenAI Error: ${response.status}`);
    }

    const data = await response.json();
    const respuestaIA = data.choices[0].message.content.trim();

    console.log('✅ Respuesta ChatGPT:', respuestaIA);

    res.json({ 
      respuesta: respuestaIA,
      tokens_usados: data.usage?.total_tokens || 0
    });

  } catch (error) {
    console.error('❌ Error en chat:', error);
    
    // 🔄 RESPUESTA DE FALLBACK
    const respuestasFallback = [
      "¡Hola! Soy el asistente de Supercasa 🏠 ¿En qué puedo ayudarte?",
      "Disculpa, tuve un problemita técnico 😅 ¿Puedes repetir tu pregunta?",
      "¡Estoy aquí para ayudarte con Supercasa! 🛒 ¿Qué necesitas saber?",
      "Lo siento, no pude procesar eso. ¿Me ayudas reformulando tu pregunta? 🤔",
      "¡Hola! Pregúntame sobre productos, pagos o entregas de Supercasa 🚀"
    ];
    
    const respuestaAleatoria = respuestasFallback[Math.floor(Math.random() * respuestasFallback.length)];
    
    res.json({ 
      respuesta: respuestaAleatoria,
      error: 'fallback'
    });
  }
});
// 📊 Endpoint para consultar estado de pedidos desde chat
app.get('/chat/pedido/:numero', authenticateToken, async (req, res) => {
  try {
    const { numero } = req.params;
    
    // Extraer ID del número (SUP-104 → 104)
    const pedidoId = numero.replace(/SUP-/i, '').replace(/sup-/i, '');
    
    console.log(`🔍 Consultando pedido ${numero} (ID: ${pedidoId}) para usuario ${req.user.userId}`);
    
    const result = await pool.query(`
      SELECT 
        id, estado, fecha, total, productos,
        torre_entrega, piso_entrega, apartamento_entrega,
        fecha_entrega, payment_status,
        EXTRACT(EPOCH FROM (NOW() - fecha))/60 as minutos_transcurridos
      FROM pedidos 
      WHERE id = $1 AND usuario_id = $2
    `, [pedidoId, req.user.userId]);
    
    if (result.rows.length === 0) {
      console.log(`❌ Pedido ${numero} no encontrado para usuario ${req.user.userId}`);
      return res.json({ 
        encontrado: false,
        mensaje: `No encontré el pedido ${numero} en tu cuenta.`
      });
    }
    
    const pedido = result.rows[0];
    const minutosTranscurridos = Math.round(pedido.minutos_transcurridos);
    
    // 🚨 LÓGICA DE ESCALAMIENTO
    let necesitaEscalamiento = false;
    let razonEscalamiento = '';
    
    if (pedido.estado === 'cancelado') {
      necesitaEscalamiento = true;
      razonEscalamiento = 'pedido_cancelado';
    } else if (pedido.estado === 'pendiente' && minutosTranscurridos > 20) {
      necesitaEscalamiento = true;
      razonEscalamiento = 'tiempo_excedido';
    }
    
    console.log(`✅ Pedido ${numero} encontrado:`, {
      estado: pedido.estado,
      minutos: minutosTranscurridos,
      escalamiento: necesitaEscalamiento
    });
    
    res.json({
      encontrado: true,
      id: pedido.id,
      numero: `SUP-${pedido.id}`,
      estado: pedido.estado,
      fecha: pedido.fecha,
      total: pedido.total,
      direccion: `Torre ${pedido.torre_entrega}, Piso ${pedido.piso_entrega}, Apt ${pedido.apartamento_entrega}`,
      minutos_transcurridos: minutosTranscurridos,
      fecha_entrega: pedido.fecha_entrega,
      payment_status: pedido.payment_status,
      necesita_escalamiento: necesitaEscalamiento,
      razon_escalamiento: razonEscalamiento
    });
    
  } catch (error) {
    console.error('❌ Error consultando pedido desde chat:', error);
    res.status(500).json({ 
      encontrado: false,
      error: 'Error consultando pedido' 
    });
  }
});

// 🆕 NUEVO: Verificar si el usuario tiene pedidos recientes
app.get('/api/verificar-pedido-reciente', authenticateToken, async (req, res) => {
  try {
    const { referencia } = req.query;
    
    console.log(`🔍 Verificando pedido reciente para usuario ${req.user.userId}`);
    
    // Buscar pedidos de los últimos 10 minutos del usuario
    const result = await pool.query(`
      SELECT id, payment_reference, payment_transaction_id, payment_status, total, fecha
      FROM pedidos 
      WHERE usuario_id = $1 
      AND fecha > NOW() - INTERVAL '10 minutes'
      AND (payment_status = 'APPROVED' OR estado != 'cancelado')
      ORDER BY fecha DESC 
      LIMIT 1
    `, [req.user.userId]);
    
    if (result.rows.length > 0) {
      const pedido = result.rows[0];
      console.log(`✅ Pedido reciente encontrado: ${pedido.id}`);
      
      return res.json({
        found: true,
        pedidoId: pedido.id,
        payment_status: pedido.payment_status,
        total: pedido.total,
        fecha: pedido.fecha
      });
    }
    
    console.log('❌ No se encontró pedido reciente');
    res.json({ found: false });
    
  } catch (error) {
    console.error('❌ Error verificando pedido reciente:', error);
    res.status(500).json({ found: false, error: 'Error interno' });
  }
});

// 🚀 Iniciar servidor
app.listen(3000, () => {
  console.log('🚀 Backend corriendo en http://localhost:3000');
  console.log('🧪 TEST DEPLOY - Chat endpoint disponible');
  console.log('🧪 veamos');
  console.log('🔐 Sistema de autenticación SIN CONTRASEÑAS activado');
  console.log('🏢 Conjunto residencial: Torres 1, 2, 3, 4, 5');
  console.log('⚡ Entrega rápida: máximo 20 minutos');
  console.log('📦 Control de inventario con stock automático');
  console.log('💳 Sistema de tracking WOMPI integrado');
  console.log('✅ Backend corregido y funcional');
});