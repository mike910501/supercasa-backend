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

// ✅ NUEVAS TABLAS PARA SISTEMA DE PROMOCIONES
// Crear tabla códigos promocionales
pool.query(`
  CREATE TABLE IF NOT EXISTS codigos_promocionales (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    descuento_porcentaje DECIMAL(5,2) DEFAULT 10.00,
    usado BOOLEAN DEFAULT FALSE,
    usuario_id INTEGER REFERENCES usuarios(id),
    fecha_uso TIMESTAMP,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT TRUE
  )
`).then(() => console.log("✅ Tabla 'codigos_promocionales' lista"))
  .catch(err => console.error("❌ Error creando tabla codigos_promocionales:", err));

// Crear tabla promociones popup
pool.query(`
  CREATE TABLE IF NOT EXISTS promociones_popup (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(100) NOT NULL,
    descripcion TEXT,
    imagen_url VARCHAR(500),
    activo BOOLEAN DEFAULT FALSE,
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_fin TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => console.log("✅ Tabla 'promociones_popup' lista"))
  .catch(err => console.error("❌ Error creando tabla promociones_popup:", err));

// Agregar campos de descuento a productos existentes
pool.query(`
  ALTER TABLE productos 
  ADD COLUMN IF NOT EXISTS descuento_activo BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS descuento_porcentaje DECIMAL(5,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS descuento_badge_texto VARCHAR(50),
  ADD COLUMN IF NOT EXISTS descuento_fecha_inicio TIMESTAMP,
  ADD COLUMN IF NOT EXISTS descuento_fecha_fin TIMESTAMP
`).then(() => console.log("✅ Campos de descuento agregados a productos"))
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
    notas_entrega,
    // ✅ NUEVOS CAMPOS PARA POLÍTICA DE DATOS
    privacy_accepted,
    marketing_accepted
  } = req.body;

  try {
    const erroresValidacion = validarDatosResidenciales(torre, piso, apartamento);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({ error: erroresValidacion.join(', ') });
    }

    if (!nombre || !email || !cedula || !telefono) {
      return res.status(400).json({ error: 'Nombre, email, cédula y teléfono son obligatorios' });
    }

    // ✅ VALIDACIÓN OBLIGATORIA DE POLÍTICA DE DATOS
    if (!privacy_accepted) {
      return res.status(400).json({ 
        error: 'Debe aceptar la política de tratamiento de datos personales para registrarse' 
      });
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

    // ✅ DATOS DE POLÍTICA CON TIMESTAMP Y VERSIÓN
    const ahora = new Date();
    const privacyData = {
      privacy_accepted: true,
      privacy_date: ahora,
      privacy_version: '1.0',
      marketing_accepted: marketing_accepted || false,
      marketing_date: marketing_accepted ? ahora : null
    };

    const result = await pool.query(
      `INSERT INTO usuarios (
        nombre, email, cedula, telefono, telefono_alternativo, 
        torre, piso, apartamento, notas_entrega,
        privacy_accepted, privacy_date, privacy_version,
        marketing_accepted, marketing_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
      RETURNING id, nombre, email, cedula, telefono, torre, piso, apartamento, rol,
               privacy_accepted, privacy_date, marketing_accepted`,
      [
        nombre, 
        emailNormalizado, 
        cedula, 
        telefono, 
        telefono_alternativo, 
        torre, 
        piso, 
        apartamento, 
        notas_entrega,
        privacyData.privacy_accepted,
        privacyData.privacy_date,
        privacyData.privacy_version,
        privacyData.marketing_accepted,
        privacyData.marketing_date
      ]
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

    // ✅ LOG PARA AUDITORÍA DE REGISTRO CON DATOS DE PRIVACIDAD
    console.log(`✅ REGISTRO EXITOSO:`, {
      user_id: user.id,
      email: user.email,
      privacy_accepted: user.privacy_accepted,
      privacy_date: user.privacy_date,
      marketing_accepted: user.marketing_accepted,
      timestamp: new Date().toISOString()
    });

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
        rol: user.rol,
        // ✅ INCLUIR DATOS DE PRIVACIDAD EN RESPUESTA
        privacy_accepted: user.privacy_accepted,
        marketing_accepted: user.marketing_accepted
      }
    });
  } catch (err) {
    console.error('❌ Error en registro:', err);
    
    // ✅ MANEJO ESPECÍFICO DE ERRORES DE BASE DE DATOS
    if (err.code === '42703') { // Column does not exist
      return res.status(500).json({ 
        error: 'Error de configuración: campos de privacidad no encontrados en base de datos' 
      });
    }
    
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

// 🛍️ Crear pedido con CONTROL DE STOCK + CÓDIGOS + PROMOCIONES
app.post('/orders', authenticateToken, async (req, res) => {
  const { 
    productos, 
    total,
    codigo_promocional, // NUEVO
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

    let totalFinal = Math.round(Number(total));

    // ✅ APLICAR CÓDIGO PROMOCIONAL SI EXISTE
    if (codigo_promocional) {
      console.log(`🎁 Aplicando código promocional: ${codigo_promocional}`);
      
      const codigoResult = await pool.query(
        'SELECT * FROM codigos_promocionales WHERE codigo = $1 AND usado = FALSE AND activo = TRUE',
        [codigo_promocional.trim().toUpperCase()]
      );
      
      if (codigoResult.rows.length > 0) {
        const codigoData = codigoResult.rows[0];
        const descuento = parseFloat(codigoData.descuento_porcentaje);
        const descuentoMonto = Math.round(totalFinal * (descuento / 100));
        totalFinal = totalFinal - descuentoMonto;
        
        console.log(`✅ Descuento aplicado: ${descuento}% = $${descuentoMonto}`);
        console.log(`💰 Total final: $${totalFinal}`);
      }
    }

    if (isNaN(totalFinal) || totalFinal <= 0) {
      console.error('🚫 totalPedido inválido:', totalFinal);
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

    // ✅ VERIFICAR STOCK
    console.log('🔍 Verificando stock de productos...');
    const erroresStock = [];
    const productosConCodigo = [];
    
    for (const item of productos) {
      const stockQuery = await pool.query(
        'SELECT id, nombre, stock, codigo, descuento_activo, descuento_porcentaje, precio FROM productos WHERE id = $1',
        [item.id]
      );
      
      if (stockQuery.rows.length === 0) {
        erroresStock.push(`Producto ID ${item.id} no encontrado`);
        continue;
      }
      
      const producto = stockQuery.rows[0];
      const stockDisponible = producto.stock || 0;
      const cantidadSolicitada = item.cantidad || 1;
      
      if (stockDisponible < cantidadSolicitada) {
        erroresStock.push(`${producto.nombre}: Stock insuficiente (disponible: ${stockDisponible}, solicitado: ${cantidadSolicitada})`);
      }
      
      // ✅ APLICAR DESCUENTO POR PRODUCTO SI EXISTE
      let precioFinal = item.precio;
      if (producto.descuento_activo && producto.descuento_porcentaje > 0) {
        precioFinal = Math.round(producto.precio * (100 - producto.descuento_porcentaje) / 100);
        console.log(`🏷️ Descuento producto ${producto.nombre}: ${producto.descuento_porcentaje}% -> $${precioFinal}`);
      }
      
      productosConCodigo.push({
        id: item.id,
        nombre: producto.nombre,
        precio: precioFinal, // Precio con descuento aplicado
        precio_original: producto.precio,
        cantidad: item.cantidad,
        codigo: producto.codigo,
        descuento_aplicado: producto.descuento_activo ? producto.descuento_porcentaje : 0
      });
    }
    
    if (erroresStock.length > 0) {
      console.log('❌ Errores de stock:', erroresStock);
      return res.status(400).json({ 
        error: 'Stock insuficiente', 
        detalles: erroresStock 
      });
    }

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
        JSON.stringify(productosConCodigo),
        totalFinal, // Usar total con descuentos aplicados
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

    const pedidoId = result.rows[0].id;

    // ✅ MARCAR CÓDIGO COMO USADO
    if (codigo_promocional) {
      await pool.query(
        `UPDATE codigos_promocionales 
         SET usado = TRUE, usuario_id = $1, fecha_uso = CURRENT_TIMESTAMP 
         WHERE codigo = $2`,
        [req.user.userId, codigo_promocional.trim().toUpperCase()]
      );
      console.log(`✅ Código ${codigo_promocional} marcado como usado`);
    }

    // ✅ REDUCIR STOCK
    console.log('📦 Reduciendo stock de productos...');
    
    for (const item of productos) {
      const cantidadSolicitada = item.cantidad || 1;
      
      await pool.query(
        'UPDATE productos SET stock = GREATEST(stock - $1, 0) WHERE id = $2',
        [cantidadSolicitada, item.id]
      );
      
      console.log(`📉 Stock reducido: Producto ID ${item.id}, cantidad: ${cantidadSolicitada}`);
    }

    res.json({ 
      success: true, 
      message: 'Pedido creado exitosamente - Entrega en máximo 20 minutos',
      pedidoId: pedidoId,
      totalFinal: totalFinal,
      descuentoAplicado: codigo_promocional ? true : false,
      entrega: `Torre ${torre_entrega}, Piso ${piso_entrega}, Apt ${apartamento_entrega}`,
      tiempoEstimado: '20 minutos máximo'
    });
  } catch (err) {
    console.error('❌ Error guardando pedido:', err);
    res.status(500).json({ error: 'Error guardando pedido' });
  }
});

// 💾 GUARDAR CARRITO TEMPORAL ANTES DEL PAGO
app.post('/api/guardar-carrito-temporal', authenticateToken, async (req, res) => {
  try {
    const { referencia, productos, datos_entrega } = req.body;
    
    console.log(`💾 Guardando carrito temporal para referencia: ${referencia}`);
    
    // Eliminar carrito anterior si existe
    await pool.query(
      'DELETE FROM carrito_temporal WHERE referencia = $1',
      [referencia]
    );
    
    // Guardar nuevo carrito
    await pool.query(
      `INSERT INTO carrito_temporal (referencia, usuario_id, productos, datos_entrega) 
       VALUES ($1, $2, $3, $4)`,
      [
        referencia,
        req.user.userId,
        JSON.stringify(productos),
        JSON.stringify(datos_entrega)
      ]
    );
    
    console.log(`✅ Carrito temporal guardado: ${productos.length} productos`);
    
    res.json({ success: true, message: 'Carrito guardado temporalmente' });
    
  } catch (error) {
    console.error('❌ Error guardando carrito temporal:', error);
    res.status(500).json({ error: 'Error guardando carrito temporal' });
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
        // 🛡️ IGNORAR PRODUCTOS CON IDs FALSOS
        if (!item.id || 
            typeof item.id === 'string' && (
              item.id.includes('webhook') || 
              item.id.includes('generic') ||
              item.id.includes('auto') ||
              isNaN(parseInt(item.id))
            )) {
          console.log(`⚠️ Ignorando producto falso: ${item.id} - ${item.nombre}`);
          continue;
        }
        
        // ✅ SOLO RESTAURAR PRODUCTOS REALES
        try {
          const cantidadARestaurar = item.cantidad || 1;
          
          await pool.query(
            'UPDATE productos SET stock = stock + $1 WHERE id = $2',
            [cantidadARestaurar, parseInt(item.id)]
          );
          
          console.log(`📈 Stock restaurado: Producto ID ${item.id}, cantidad: +${cantidadARestaurar}`);
        } catch (error) {
          console.error(`❌ Error restaurando stock para producto ${item.id}:`, error.message);
        }
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

// ✅ WEBHOOK WOMPI INTELIGENTE - CON SOPORTE PARA TARJETAS
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
      const paymentMethod = transaction.payment_method_type; // 🆕 Capturar método de pago
      
      console.log(`📦 Procesando transacción ${transactionId} - Estado: ${status} - Método: ${paymentMethod}`);
      
      // 🆕 LOG ESPECÍFICO PARA TARJETAS
      if (paymentMethod === 'CARD') {
        console.log('💳 Webhook procesando pago con TARJETA');
      }
      
      // Buscar pedido existente
      const pedidoResult = await pool.query(
        'SELECT id, productos FROM pedidos WHERE payment_reference = $1 OR payment_transaction_id = $2',
        [reference, transactionId]
      );
      
      if (pedidoResult.rows.length === 0 && status === 'APPROVED') {
        console.log(`🚨 PEDIDO NO ENCONTRADO - Creando desde webhook para transacción ${transactionId}`);
        
        try {
          // Buscar usuario por email
          const userResult = await pool.query(
            'SELECT id, nombre, torre, piso, apartamento FROM usuarios WHERE email = $1',
            [transaction.customer_email]
          );
          
          if (userResult.rows.length > 0) {
            const usuario = userResult.rows[0];
            
            // 🆕 INTENTAR RECUPERAR PRODUCTOS REALES
            let productosReales = [];
            
            // 💾 RECUPERAR CARRITO REAL DESDE TABLA TEMPORAL
            console.log(`💾 Buscando carrito temporal para referencia: ${reference}`);

            const carritoTemp = await pool.query(
              'SELECT productos, datos_entrega FROM carrito_temporal WHERE referencia = $1',
              [reference]
            );

            if (carritoTemp.rows.length > 0) {
              console.log('✅ Carrito temporal encontrado');
              
              // 🆕 LOG ESPECÍFICO PARA TARJETAS
              if (paymentMethod === 'CARD') {
                console.log('💳 Procesando carrito de pago con TARJETA');
              }
              
              // 🛠️ PARSING SEGURO - VERIFICAR SI ES OBJETO O STRING
              const productosCarrito = typeof carritoTemp.rows[0].productos === 'string' 
                ? JSON.parse(carritoTemp.rows[0].productos) 
                : carritoTemp.rows[0].productos;

              const datosEntrega = typeof carritoTemp.rows[0].datos_entrega === 'string' 
                ? JSON.parse(carritoTemp.rows[0].datos_entrega) 
                : carritoTemp.rows[0].datos_entrega;
              
              // Usar productos reales del carrito
              for (const item of productosCarrito) {
                productosReales.push({
                  id: item.id,
                  nombre: item.nombre,
                  precio: item.precio,
                  cantidad: item.cantidad,
                  codigo: item.codigo || `TEMP-${item.id}`
                });
                
                // 🆕 REDUCIR STOCK DE PRODUCTOS REALES
                if (item.id && !isNaN(parseInt(item.id))) {
                  await pool.query(
                    'UPDATE productos SET stock = GREATEST(stock - $1, 0) WHERE id = $2',
                    [item.cantidad, item.id]
                  );
                  
                  console.log(`📉 Stock reducido: Producto ID ${item.id}, cantidad: ${item.cantidad}`);
                }
              }
              
              // Actualizar datos de entrega si están disponibles
              if (datosEntrega.torre_entrega) {
                usuario.torre = datosEntrega.torre_entrega;
                usuario.piso = datosEntrega.piso_entrega;
                usuario.apartamento = datosEntrega.apartamento_entrega;
              }
              
              // Limpiar carrito temporal después de usar
              await pool.query('DELETE FROM carrito_temporal WHERE referencia = $1', [reference]);
              console.log('🗑️ Carrito temporal eliminado');
              
            } else {
              console.log('⚠️ No se encontró carrito temporal, usando productos estimados...');
              
              // FALLBACK: Código original de productos estimados
              const productosPopulares = await pool.query(`
                SELECT p.id, p.nombre, p.precio, p.stock
                FROM productos p
                WHERE p.stock > 0
                ORDER BY p.id ASC
                LIMIT 3
              `);
              
              if (productosPopulares.rows.length > 0) {
                const montoTotal = transaction.amount_in_cents / 100;
                let montoRestante = montoTotal;
                
                for (const producto of productosPopulares.rows) {
                  if (montoRestante <= 0) break;
                  
                  const cantidad = Math.min(
                    Math.floor(montoRestante / producto.precio), 
                    producto.stock,
                    3
                  );
                  
                  if (cantidad > 0) {
                    productosReales.push({
                      id: producto.id,
                      nombre: producto.nombre,
                      precio: producto.precio,
                      cantidad: cantidad,
                      codigo: `AUTO-${producto.id}`
                    });
                    
                    montoRestante -= (producto.precio * cantidad);
                  }
                }
              }
              
              // Si no se pudo crear productos reales, usar uno genérico
              if (productosReales.length === 0) {
                productosReales = [{
                  id: 'webhook-generic',
                  nombre: 'Pedido procesado por webhook',
                  cantidad: 1,
                  precio: transaction.amount_in_cents / 100,
                  codigo: 'WEBHOOK-AUTO'
                }];
              }
            }
            
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
    JSON.stringify(productosReales),
    transaction.amount_in_cents / 100,
    usuario.torre || '1',
    parseInt(usuario.piso) || 1,    // ← CONVERSIÓN A INTEGER
    usuario.apartamento || '101',
    'Webhook auto',
    reference,
    'APPROVED',
    paymentMethod,
    transactionId,
    transaction.amount_in_cents,
    'pendiente'
  ]
);

            // 🆕 LOG ESPECÍFICO PARA TARJETAS
            if (paymentMethod === 'CARD') {
              console.log(`💳 Pedido con TARJETA ${pedidoWebhook.rows[0].id} creado exitosamente`);
            } else {
              console.log(`✅ Pedido ${pedidoWebhook.rows[0].id} creado desde webhook con productos reales`);
            }

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
          
          // 🆕 LOG ESPECÍFICO PARA TARJETAS
          if (paymentMethod === 'CARD') {
            console.log(`💳 Pedido con TARJETA ${pedido.id} actualizado como APROBADO vía webhook`);
          } else {
            console.log(`✅ Pedido ${pedido.id} actualizado como APROBADO vía webhook`);
          }
          
        } else if (status === 'DECLINED') {
          await pool.query(
            'UPDATE pedidos SET payment_status = $1, estado = $2 WHERE id = $3',
            ['DECLINED', 'cancelado', pedido.id]
          );
          
          // 🆕 LOG ESPECÍFICO PARA TARJETAS
          if (paymentMethod === 'CARD') {
            console.log(`💳 Pago con TARJETA ${pedido.id} marcado como RECHAZADO vía webhook`);
          } else {
            console.log(`❌ Pedido ${pedido.id} marcado como RECHAZADO vía webhook`);
          }
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

// ===== TEST WOMPI API DIRECTA =====
app.get('/test-wompi-api', async (req, res) => {
  try {
    console.log('🧪 Iniciando test WOMPI API Directa...');
    
    // Verificar que las claves están disponibles
    const PUBLIC_KEY = 'pub_prod_GkQ7DyAjNXb63f1Imr9OQ1YNHLXd89FT';
    const PRIVATE_KEY = 'prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR';
    
    console.log('🔑 Public key:', PUBLIC_KEY ? 'ENCONTRADA' : 'FALTANTE');
    console.log('🔑 Private key:', PRIVATE_KEY ? 'ENCONTRADA' : 'FALTANTE');
    
    // Test 1: Llamar endpoint merchant (lo que falla en el widget)
    const merchantUrl = `https://api.wompi.co/v1/merchants/${PUBLIC_KEY}`;
    console.log('🌐 Llamando:', merchantUrl);
    
    const merchantResponse = await fetch(merchantUrl);
    const merchantData = await merchantResponse.json();
    
    console.log('📊 Status:', merchantResponse.status);
    console.log('📊 Response:', merchantData);
    
    // Respuesta del test
    res.json({
      timestamp: new Date().toISOString(),
      test_name: 'WOMPI API Directa - Merchant Check',
      merchant_url: merchantUrl,
      status_code: merchantResponse.status,
      success: merchantResponse.ok,
      merchant_data: merchantData,
      keys_present: {
        public: !!PUBLIC_KEY,
        private: !!PRIVATE_KEY
      }
    });
    
  } catch (error) {
    console.error('❌ Error en test WOMPI:', error.message);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
});

// ===== TEST PSE CORREGIDO =====
app.get('/test-pse', async (req, res) => {
  try {
    console.log('🧪 Test PSE corregido...');
    
    const crypto = await import('crypto');
    
    // Obtener tokens frescos
    const merchantResponse = await fetch(`https://api.wompi.co/v1/merchants/pub_prod_GkQ7DyAjNXb63f1Imr9OQ1YNHLXd89FT`);
    const merchantData = await merchantResponse.json();
    
    const acceptanceToken = merchantData.data.presigned_acceptance.acceptance_token;
    const personalDataToken = merchantData.data.presigned_personal_data_auth.acceptance_token;
    
    // Datos PSE
    const reference = `test_pse_${Date.now()}`;
    const amountInCents = 150000;
    const currency = 'COP';
    const integrityKey = 'prod_integrity_70Ss0SPlsMMTT4uSx4zz85lOCTVtLKDa';
    
    const stringToSign = `${reference}${amountInCents}${currency}${integrityKey}`;
    const signature = crypto.createHash('sha256').update(stringToSign).digest('hex');
    
    const transactionData = {
      amount_in_cents: amountInCents,
      currency: currency,
      signature: signature,
      customer_email: 'test@supercasa.com',
      payment_method: {
        type: 'PSE',
        user_type: '0', // Persona natural
        user_legal_id_type: 'CC',
        user_legal_id: '1024518451',
        financial_institution_code: '1022', // Banco de Bogotá
        payment_description: 'Compra SuperCasa' // ✅ AGREGADO
      },
      reference: reference,
      redirect_url: 'https://supercasa2.netlify.app',
      acceptance_token: acceptanceToken,
      personal_data_auth_token: personalDataToken
    };
    
    const response = await fetch('https://api.wompi.co/v1/transactions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionData)
    });
    
    const result = await response.json();
    
    res.json({
      test_name: 'PSE Test Corregido',
      status: response.status,
      success: response.ok,
      response_data: result
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ===== TEST NEQUI CORREGIDO =====
app.get('/test-nequi', async (req, res) => {
  try {
    console.log('🧪 Test Nequi corregido...');
    
    const crypto = await import('crypto');
    
    // Obtener tokens frescos
    const merchantResponse = await fetch(`https://api.wompi.co/v1/merchants/pub_prod_GkQ7DyAjNXb63f1Imr9OQ1YNHLXd89FT`);
    const merchantData = await merchantResponse.json();
    
    const acceptanceToken = merchantData.data.presigned_acceptance.acceptance_token;
    const personalDataToken = merchantData.data.presigned_personal_data_auth.acceptance_token;
    
    // Datos Nequi
    const reference = `test_nequi_${Date.now()}`;
    const amountInCents = 150000;
    const currency = 'COP';
    const integrityKey = 'prod_integrity_70Ss0SPlsMMTT4uSx4zz85lOCTVtLKDa';
    
    const stringToSign = `${reference}${amountInCents}${currency}${integrityKey}`;
    const signature = crypto.createHash('sha256').update(stringToSign).digest('hex');
    
    const transactionData = {
      amount_in_cents: amountInCents,
      currency: currency,
      signature: signature,
      customer_email: 'test@supercasa.com',
      payment_method: {
        type: 'NEQUI',
        phone_number: '3001234567' // ✅ CORREGIDO: phone_number no phone
      },
      reference: reference,
      redirect_url: 'https://supercasa2.netlify.app',
      acceptance_token: acceptanceToken,
      personal_data_auth_token: personalDataToken
    };
    
    const response = await fetch('https://api.wompi.co/v1/transactions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionData)
    });
    
    const result = await response.json();
    
    res.json({
      test_name: 'Nequi Test Corregido',
      status: response.status,
      success: response.ok,
      response_data: result
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================
// 💳 NUEVO SISTEMA WOMPI API DIRECTA
// ===================

// 🆕 ENDPOINT PRINCIPAL - CREAR PAGO
app.post('/api/crear-pago', authenticateToken, async (req, res) => {
  try {
    const { 
      metodoPago, // 'DAVIPLATA', 'NEQUI', 'PSE', 'CARD'
      monto, 
      productos,
      datosEntrega,
      telefono,
      cedula,
      banco // Para PSE
    } = req.body;

    console.log(`💳 Creando pago ${metodoPago} por $${monto}`);

    const crypto = await import('crypto');

    // Obtener tokens frescos
    const merchantResponse = await fetch(`https://api.wompi.co/v1/merchants/pub_prod_GkQ7DyAjNXb63f1Imr9OQ1YNHLXd89FT`);
    const merchantData = await merchantResponse.json();
    
    if (!merchantResponse.ok) {
      throw new Error('Error obteniendo merchant data');
    }

    const acceptanceToken = merchantData.data.presigned_acceptance.acceptance_token;
    const personalDataToken = merchantData.data.presigned_personal_data_auth.acceptance_token;

    // Generar referencia única
    const reference = `SUP_${metodoPago}_${Date.now()}`;
    const amountInCents = Math.round(monto * 100);
    const integrityKey = 'prod_integrity_70Ss0SPlsMMTT4uSx4zz85lOCTVtLKDa';

    // Firma de integridad
    const stringToSign = `${reference}${amountInCents}COP${integrityKey}`;
    const signature = crypto.createHash('sha256').update(stringToSign).digest('hex');

    // Configurar método de pago específico
    let paymentMethod = {};

    switch (metodoPago) {
      case 'DAVIPLATA':
        paymentMethod = {
          type: 'DAVIPLATA',
          phone: telefono,
          user_legal_id_type: 'CC',
          user_legal_id: cedula
        };
        break;

      case 'NEQUI':
        paymentMethod = {
          type: 'NEQUI',
          phone_number: telefono
        };
        break;

      case 'PSE':
        paymentMethod = {
          type: 'PSE',
          user_type: '0',
          user_legal_id_type: 'CC',
          user_legal_id: cedula,
          financial_institution_code: banco,
          payment_description: 'Compra SuperCasa'
        };
        break;
        case 'CARD':
  console.log('💳 Procesando pago con tarjeta...');
  
  // Verificar que se envió el token de la tarjeta
  if (!req.body.payment_source_id) {
    return res.status(400).json({
      success: false,
      error: 'Token de tarjeta requerido'
    });
  }

  paymentMethod = {
    type: 'CARD',
    token: req.body.payment_source_id,
    installments: req.body.installments || 1
  };
  
  console.log('🔐 Token de tarjeta recibido:', req.body.payment_source_id);
  break;

      default:
        return res.status(400).json({ error: 'Método de pago no soportado' });
    }

    // Datos de la transacción
    const transactionData = {
      amount_in_cents: amountInCents,
      currency: 'COP',
      signature: signature,
      customer_email: req.user.email,
      payment_method: paymentMethod,
      reference: reference,
      redirect_url: 'https://supercasa2.netlify.app',
      acceptance_token: acceptanceToken,
      personal_data_auth_token: personalDataToken
    };

// Si es PSE, agregar customer_data (con consulta de nombre)
if (metodoPago === 'PSE') {
  // ✅ OBTENER NOMBRE DEL USUARIO DESDE BD
  console.log('🔍 PSE - Obteniendo nombre del usuario:', req.user.userId);
  
  const userQuery = await pool.query(
    'SELECT nombre FROM usuarios WHERE id = $1',
    [req.user.userId]
  );
  
  const fullName = userQuery.rows.length > 0 ? userQuery.rows[0].nombre : 'Usuario SuperCasa';
  
  const customerData = {
    phone_number: telefono,
    full_name: fullName  // ✅ AHORA SÍ tiene valor
  };
  
  console.log('🔍 PSE DEBUG - customer_data que se enviará:', customerData);
  console.log('🔍 PSE DEBUG - full_name obtenido:', fullName);
  
  transactionData.customer_data = customerData;
}

// ✅ LOG COMPLETO DE TRANSACTION DATA
console.log('📤 PSE DEBUG - transactionData completo:', JSON.stringify(transactionData, null, 2));

console.log(`📤 Enviando transacción ${metodoPago} a WOMPI...`);

    console.log(`📤 Enviando transacción ${metodoPago} a WOMPI...`);

    // Llamada a WOMPI
    const wompiResponse = await fetch('https://api.wompi.co/v1/transactions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionData)
    });

    const wompiResult = await wompiResponse.json();

   if (!wompiResponse.ok) {
  console.error('❌ Error WOMPI COMPLETO:', JSON.stringify(wompiResult, null, 2));
  return res.status(400).json({ 
    error: 'Error creando pago', 
    detalles: wompiResult 
  });
}

    const transaction = wompiResult.data;
    
    console.log(`✅ Transacción creada: ${transaction.id}`);

    // Guardar carrito temporal para webhook
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS carrito_temporal (
          id SERIAL PRIMARY KEY,
          referencia VARCHAR(100) UNIQUE,
          usuario_id INTEGER,
          productos JSONB,
          datos_entrega JSONB,
          fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(
        `INSERT INTO carrito_temporal (referencia, usuario_id, productos, datos_entrega) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (referencia) DO UPDATE SET 
         productos = $3, datos_entrega = $4`,
        [
          reference,
          req.user.userId,
          JSON.stringify(productos),
          JSON.stringify(datosEntrega)
        ]
      );

      console.log(`💾 Carrito temporal guardado: ${reference}`);
    } catch (error) {
      console.error('⚠️ Error guardando carrito temporal:', error);
    }

      // ✅ ESPERAR 5 segundos para que WOMPI procese completamente
    console.log('⏳ Esperando 5 segundos para consulta de detalles...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Consultar detalles completos de la transacción para obtener URLs específicas
    console.log('🔍 Consultando detalles de transacción:', transaction.id);
    const transactionDetailsResponse = await fetch(
      `https://api.wompi.co/v1/transactions/${transaction.id}`,
      {
        headers: {
          'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
          'Accept': 'application/json'
        }
      }
    );

    const transactionDetails = await transactionDetailsResponse.json();

    // ✅ LOGS DE DEBUG TEMPORALES
    console.log('🔍 DEBUG - Status consulta detalles:', transactionDetailsResponse.status);
    console.log('🔍 DEBUG - Transaction details completos:', JSON.stringify(transactionDetails, null, 2));
    console.log('🔍 DEBUG - Payment method extra:', transactionDetails.data?.payment_method?.extra);
    console.log('🔍 DEBUG - URL extraída:', transactionDetails.data?.payment_method?.extra?.url);
    
// Extraer URL específica según método de pago
    let redirectUrl = null;
    if (metodoPago === 'DAVIPLATA' && transactionDetails.data?.payment_method?.extra?.url) {
      redirectUrl = transactionDetails.data.payment_method.extra.url;
      console.log('🔗 URL DaviPlata encontrada:', redirectUrl);
    } else if (metodoPago === 'PSE' && transactionDetails.data?.payment_method?.extra?.pseURL) {
      redirectUrl = transactionDetails.data.payment_method.extra.pseURL;
      console.log('🔗 URL PSE encontrada:', redirectUrl);
    } else if (metodoPago === 'DAVIPLATA') {
      console.log('⚠️ URL DaviPlata no encontrada en extra, intentando consulta adicional...');
      
      // Intentar consulta adicional después de más tiempo
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const retryResponse = await fetch(
        `https://api.wompi.co/v1/transactions/${transaction.id}`,
        {
          headers: {
            'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
            'Accept': 'application/json'
          }
        }
      );
      
      const retryDetails = await retryResponse.json();
      console.log('🔄 RETRY - Payment method extra:', retryDetails.data?.payment_method?.extra);
      
      if (retryDetails.data?.payment_method?.extra?.url) {
        redirectUrl = retryDetails.data.payment_method.extra.url;
        console.log('🔗 URL DaviPlata encontrada en retry:', redirectUrl);
      }
    }

    // ✅ LOG FINAL ANTES DE ENVIAR RESPUESTA
    console.log('📤 DEBUG - Respuesta final que se envía:', {
      metodoPago,
      redirectUrl,
      payment_method_details: transactionDetails.data?.payment_method
    });

    // ✅ RESPUESTA ÚNICA AL FRONTEND
    res.json({
      success: true,
      transactionId: transaction.id,
      reference: transaction.reference,
      status: transaction.status,
      metodoPago: metodoPago,
      monto: monto,
      redirectUrl: transaction.redirect_url,
      // ✅ URLs específicas según método de pago
      daviplataUrl: metodoPago === 'DAVIPLATA' ? redirectUrl : null,
      pseUrl: metodoPago === 'PSE' ? redirectUrl : null,
      payment_method_type: transaction.payment_method_type,
      // Datos adicionales para debug
      payment_method_details: transactionDetails.data?.payment_method
    });

  } catch (error) {
    console.error('❌ Error creando pago:', error);
    
    // Solo responder si no se ha enviado respuesta ya
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Error interno creando pago',
        message: error.message 
      });
    }
  }
});

// ===== NUEVO: ENDPOINT PARA TOKENIZAR TARJETAS =====
app.post('/api/tokenizar-tarjeta', authenticateToken, async (req, res) => {
  try {
    const { number, cvc, exp_month, exp_year, card_holder } = req.body;
    
    console.log('📝 Iniciando tokenización de tarjeta...');
    
    // Validar datos de entrada
    if (!number || !cvc || !exp_month || !exp_year || !card_holder) {
      return res.status(400).json({
        success: false,
        error: 'Todos los campos de la tarjeta son requeridos'
      });
    }

    // Crear token de tarjeta con WOMPI
    const tokenPayload = {
      number: number.replace(/\s/g, ''), // Limpiar espacios
      cvc: cvc,
      exp_month: exp_month,
      exp_year: exp_year,
      card_holder: card_holder.trim().toUpperCase()
    };

    console.log('🔐 Enviando datos para tokenización:', {
      number: `****${number.slice(-4)}`,
      exp_month,
      exp_year,
      card_holder
    });

    const tokenResponse = await fetch('https://api.wompi.co/v1/tokens/cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer pub_prod_GkQ7DyAjNXb63f1Imr9OQ1YNHLXd89FT`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(tokenPayload)
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('❌ Error en tokenización:', tokenData);
      return res.status(400).json({
        success: false,
        error: tokenData.error?.reason || 'Error al tokenizar la tarjeta',
        details: tokenData.error
      });
    }

    console.log('✅ Tarjeta tokenizada exitosamente:', tokenData.data.id);

    res.json({
      success: true,
      data: tokenData.data
    });

  } catch (error) {
    console.error('💥 Error en tokenización de tarjeta:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor en tokenización'
    });
  }
});

// 🔍 ENDPOINT VERIFICACIÓN DE PAGO
app.get('/api/consultar-pago/:transactionId', authenticateToken, async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    console.log(`🔍 Consultando transacción: ${transactionId}`);

    // PASO 1: Buscar en base de datos local
    const pedidoLocal = await pool.query(`
      SELECT * FROM pedidos 
      WHERE payment_transaction_id = $1 
      OR payment_reference = $1 
      OR payment_reference LIKE $2
      ORDER BY fecha DESC LIMIT 1
    `, [transactionId, `%${transactionId}%`]);

    if (pedidoLocal.rows.length > 0) {
      const pedido = pedidoLocal.rows[0];
      console.log(`✅ Pedido encontrado en BD: ${pedido.id}`);
      
      return res.json({
        found: true,
        status: pedido.payment_status,
        pedidoId: pedido.id,
        reference: pedido.payment_reference,
        source: 'database'
      });
    }

    // PASO 2: Consultar directamente a WOMPI
    console.log(`🌐 Consultando WOMPI API para: ${transactionId}`);
    
    const wompiResponse = await fetch(
      `https://api.wompi.co/v1/transactions/${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
          'Accept': 'application/json'
        }
      }
    );

    if (!wompiResponse.ok) {
      console.log(`❌ WOMPI API error: ${wompiResponse.status}`);
      return res.json({
        found: false,
        status: 'PENDING',
        message: 'Transacción en proceso...'
      });
    }

    const wompiData = await wompiResponse.json();
    const transaction = wompiData.data;
    
    console.log(`📊 WOMPI status: ${transaction.status}`);

    // PASO 3: Si WOMPI dice APPROVED pero no tenemos pedido, esperar webhook
    if (transaction.status === 'APPROVED') {
      
      // Dar tiempo al webhook para procesar
      console.log('⏳ Pago aprobado, esperando webhook...');
      
      // Esperar hasta 10 segundos para que webhook cree el pedido
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const pedidoCreado = await pool.query(`
          SELECT * FROM pedidos 
          WHERE payment_transaction_id = $1 
          OR payment_reference = $2
          ORDER BY fecha DESC LIMIT 1
        `, [transactionId, transaction.reference]);
        
        if (pedidoCreado.rows.length > 0) {
          const pedido = pedidoCreado.rows[0];
          console.log(`✅ Webhook creó pedido: ${pedido.id}`);
          
          return res.json({
            found: true,
            status: 'APPROVED',
            pedidoId: pedido.id,
            reference: transaction.reference,
            source: 'webhook'
          });
        }
      }
      
      // Si llegamos aquí, pago aprobado pero sin pedido
      console.log('⚠️ Pago aprobado pero pedido no creado por webhook');
    }

    // PASO 4: Responder con status de WOMPI
    res.json({
      found: true,
      status: transaction.status,
      reference: transaction.reference,
      amount: transaction.amount_in_cents / 100,
      payment_method: transaction.payment_method_type,
      source: 'wompi_api'
    });

  } catch (error) {
    console.error('❌ Error consultando pago:', error);
    res.status(500).json({ 
      found: false,
      status: 'ERROR',
      message: 'Error consultando estado del pago'
    });
  }
});

// 🔍 DEBUG - Ver exactamente qué enviamos a WOMPI para DaviPlata
app.get('/debug-daviplata-last', async (req, res) => {
  try {
    // Buscar la última transacción DaviPlata de los logs
    console.log('🔍 Buscando última transacción DaviPlata...');
    
    // Simular la misma llamada que hacemos en crear-pago
    const crypto = await import('crypto');
    
    const merchantResponse = await fetch(`https://api.wompi.co/v1/merchants/pub_prod_GkQ7DyAjNXb63f1Imr9OQ1YNHLXd89FT`);
    const merchantData = await merchantResponse.json();
    
    const acceptanceToken = merchantData.data.presigned_acceptance.acceptance_token;
    const personalDataToken = merchantData.data.presigned_personal_data_auth.acceptance_token;
    
    const reference = `debug_daviplata_${Date.now()}`;
    const amountInCents = 250000; // $2,500
    const integrityKey = 'prod_integrity_70Ss0SPlsMMTT4uSx4zz85lOCTVtLKDa';
    
    const stringToSign = `${reference}${amountInCents}COP${integrityKey}`;
    const signature = crypto.createHash('sha256').update(stringToSign).digest('hex');
    
    const transactionData = {
      amount_in_cents: amountInCents,
      currency: 'COP',
      signature: signature,
      customer_email: 'mikehuertas91@gmail.com', // Tu email real
      payment_method: {
        type: 'DAVIPLATA',
        phone: '3133592457', // Tu número real
        user_legal_id_type: 'CC',
        user_legal_id: '1024518451' // Tu cédula real
      },
      reference: reference,
      redirect_url: 'https://supercasa2.netlify.app',
      acceptance_token: acceptanceToken,
      personal_data_auth_token: personalDataToken
    };
    
    console.log('📤 ENVIANDO A WOMPI:', JSON.stringify(transactionData, null, 2));
    
    const wompiResponse = await fetch('https://api.wompi.co/v1/transactions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionData)
    });
    
    const wompiResult = await wompiResponse.json();
    
    console.log('📥 RESPUESTA WOMPI:', JSON.stringify(wompiResult, null, 2));
    
    // Si la respuesta es exitosa, consultar detalles de la transacción
    if (wompiResponse.ok && wompiResult.data) {
      const transactionId = wompiResult.data.id;
      
      // Esperar 5 segundos y consultar estado
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const consultaResponse = await fetch(
        `https://api.wompi.co/v1/transactions/${transactionId}`,
        {
          headers: {
            'Authorization': `Bearer prv_prod_bR8TUl71quylBwNiQcNn8OIFD1i9IdsR`,
            'Accept': 'application/json'
          }
        }
      );
      
      const consultaResult = await consultaResponse.json();
      
      console.log('🔍 CONSULTA RESULTADO:', JSON.stringify(consultaResult, null, 2));
      
      res.json({
        debug: 'DaviPlata Transaction Debug',
        request_data: transactionData,
        wompi_response: wompiResult,
        transaction_query: consultaResult,
        // Verificar si WOMPI incluye instrucciones especiales para DaviPlata
        special_instructions: consultaResult.data?.payment_method || 'No instructions found'
      });
    } else {
      res.json({
        debug: 'DaviPlata Transaction Debug - ERROR',
        request_data: transactionData,
        wompi_response: wompiResult,
        error: 'Transaction creation failed'
      });
    }
    
  } catch (error) {
    console.error('❌ Error en debug:', error);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
});

// ===================
// 🎁 RUTAS DE PROMOCIONES
// ===================


// 📄 Obtener todos los códigos promocionales (solo admin)
app.get('/api/admin/codigos-promocionales/lista', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { estado = 'todos', formato = 'json' } = req.query;
    
    let query = 'SELECT codigo, usado, fecha_creacion, fecha_uso FROM codigos_promocionales';
    let params = [];
    
    if (estado === 'disponibles') {
      query += ' WHERE usado = FALSE';
    } else if (estado === 'usados') {
      query += ' WHERE usado = TRUE';
    }
    
    query += ' ORDER BY codigo ASC';
    
    const result = await pool.query(query, params);
    
    console.log(`📄 Obteniendo ${result.rows.length} códigos (estado: ${estado})`);
    
    if (formato === 'csv') {
      // Generar CSV para imprenta
      const csvHeader = 'CODIGO,ESTADO,FECHA_CREACION\n';
      const csvData = result.rows.map(row => 
        `${row.codigo},${row.usado ? 'USADO' : 'DISPONIBLE'},${row.fecha_creacion.toISOString().split('T')[0]}`
      ).join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="codigos_supercasa.csv"');
      res.send(csvHeader + csvData);
    } else if (formato === 'txt') {
      // Generar TXT simple para imprenta
      const txtData = result.rows.map(row => row.codigo).join('\n');
      
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="codigos_supercasa.txt"');
      res.send(txtData);
    } else {
      // JSON para el admin
      res.json({
        success: true,
        total: result.rows.length,
        codigos: result.rows
      });
    }
    
  } catch (error) {
    console.error('❌ Error obteniendo códigos:', error);
    res.status(500).json({ error: 'Error obteniendo códigos' });
  }
});

// 📊 Obtener estadísticas de códigos (solo admin)
app.get('/api/admin/codigos-promocionales/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM codigos_promocionales'),
      pool.query('SELECT COUNT(*) as usados FROM codigos_promocionales WHERE usado = TRUE'),
      pool.query('SELECT COUNT(*) as disponibles FROM codigos_promocionales WHERE usado = FALSE AND activo = TRUE')
    ]);
    
    res.json({
      total: parseInt(stats[0].rows[0].total),
      usados: parseInt(stats[1].rows[0].usados),
      disponibles: parseInt(stats[2].rows[0].disponibles)
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

app.post('/api/validar-codigo-promocional', authenticateToken, async (req, res) => {
  try {
    const { codigo } = req.body;
    const userId = req.user.userId;
    
    if (!codigo) {
      return res.status(400).json({
        valido: false,
        error: 'Código requerido'
      });
    }
    
    console.log(`🔍 Validando código: ${codigo} para usuario: ${userId}`);
    
    // Buscar código
    const codigoResult = await pool.query(
      'SELECT * FROM codigos_promocionales WHERE codigo = $1',
      [codigo.trim().toUpperCase()]
    );
    
    if (codigoResult.rows.length === 0) {
      return res.json({
        valido: false,
        error: 'Código no válido'
      });
    }
    
    const codigoData = codigoResult.rows[0];
    
    // Verificar si ya fue usado
    if (codigoData.usado) {
      return res.json({
        valido: false,
        error: 'Este código ya fue utilizado'
      });
    }
    
    // Verificar si está activo
    if (!codigoData.activo) {
      return res.json({
        valido: false,
        error: 'Código no disponible'
      });
    }
    
    // 🆕 NUEVA LÓGICA POR TIPO DE CUPÓN
    const tipoCupon = codigoData.tipo || 'bienvenida';
    
    if (tipoCupon === 'bienvenida') {
      // Solo primera compra
      const pedidosUsuario = await pool.query(
        'SELECT COUNT(*) as total FROM pedidos WHERE usuario_id = $1 AND estado != $2',
        [userId, 'cancelado']
      );
      
      const esPrimeraCompra = parseInt(pedidosUsuario.rows[0].total) === 0;
      
      if (!esPrimeraCompra) {
        return res.json({
          valido: false,
          error: 'Este descuento es solo para tu primera compra'
        });
      }
    } else if (tipoCupon === 'usuario_unico') {
      // Una vez por usuario (independiente de cuántos pedidos tenga)
      const codigoUsadoPorUsuario = await pool.query(
        'SELECT COUNT(*) as total FROM codigos_promocionales WHERE usuario_id = $1 AND usado = TRUE',
        [userId]
      );
      
      if (parseInt(codigoUsadoPorUsuario.rows[0].total) > 0) {
        return res.json({
          valido: false,
          error: 'Ya has usado un código promocional anteriormente'
        });
      }
    }
    // Si es tipo 'general', no hay restricciones adicionales
    
    console.log(`✅ Código válido: ${codigo}, tipo: ${tipoCupon}, descuento: ${codigoData.descuento_porcentaje}%`);
    
    res.json({
      valido: true,
      codigo: codigoData.codigo,
      descuento: parseFloat(codigoData.descuento_porcentaje),
      tipo: tipoCupon,
      mensaje: `¡Código válido! ${codigoData.descuento_porcentaje}% de descuento aplicado`
    });
    
  } catch (error) {
    console.error('❌ Error validando código:', error);
    res.status(500).json({
      valido: false,
      error: 'Error validando código'
    });
  }
});

// 💰 Aplicar código promocional al crear pedido
app.post('/api/aplicar-codigo-promocional', authenticateToken, async (req, res) => {
  try {
    const { codigo, pedido_id } = req.body;
    const userId = req.user.userId;
    
    // Marcar código como usado
    const result = await pool.query(
      `UPDATE codigos_promocionales 
       SET usado = TRUE, usuario_id = $1, fecha_uso = CURRENT_TIMESTAMP 
       WHERE codigo = $2 AND usado = FALSE 
       RETURNING *`,
      [userId, codigo.trim().toUpperCase()]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Código no válido o ya usado' });
    }
    
    console.log(`✅ Código ${codigo} marcado como usado para pedido ${pedido_id}`);
    
    res.json({
      success: true,
      message: 'Código aplicado exitosamente',
      codigo_usado: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error aplicando código:', error);
    res.status(500).json({ error: 'Error aplicando código promocional' });
  }
});

// 🖼️ Gestión de promociones popup (admin)
app.get('/api/promociones-popup', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM promociones_popup WHERE activo = TRUE AND (fecha_fin IS NULL OR fecha_fin > CURRENT_TIMESTAMP) ORDER BY fecha_inicio DESC LIMIT 1'
    );
    
    res.json({
      activa: result.rows.length > 0,
      promocion: result.rows[0] || null
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo promoción popup:', error);
    res.status(500).json({ error: 'Error obteniendo promoción' });
  }
});

// 🎉 Crear promoción popup (admin) - ¡ESTA TE FALTA!
app.post('/api/admin/promociones-popup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { titulo, descripcion, imagen_url } = req.body;
    
    console.log(`🎉 Creando promoción popup: ${titulo}`);
    
    // Desactivar promociones anteriores
    await pool.query('UPDATE promociones_popup SET activo = FALSE');
    
    // Crear nueva promoción
    const result = await pool.query(
      `INSERT INTO promociones_popup (titulo, descripcion, imagen_url, activo) 
       VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [titulo, descripcion, imagen_url]
    );
    
    console.log(`✅ Promoción popup creada exitosamente: ${titulo}`);
    
    res.json({
      success: true,
      promocion: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error creando promoción popup:', error);
    res.status(500).json({ error: 'Error creando promoción' });
  }
});

// 🗑️ Desactivar promoción popup (admin)
app.put('/api/admin/promociones-popup/desactivar', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE promociones_popup SET activo = FALSE WHERE activo = TRUE RETURNING *'
    );
    
    console.log(`✅ ${result.rowCount} promociones popup desactivadas`);
    
    res.json({
      success: true,
      message: 'Promociones desactivadas exitosamente',
      promociones_desactivadas: result.rowCount
    });
    
  } catch (error) {
    console.error('❌ Error desactivando promociones popup:', error);
    res.status(500).json({ error: 'Error desactivando promociones' });
  }
});

app.post('/api/admin/promociones-popup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { titulo, descripcion, imagen_url } = req.body;
    
    // Desactivar promociones anteriores
    await pool.query('UPDATE promociones_popup SET activo = FALSE');
    
    // Crear nueva promoción
    const result = await pool.query(
      `INSERT INTO promociones_popup (titulo, descripcion, imagen_url, activo) 
       VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [titulo, descripcion, imagen_url]
    );
    
    console.log(`✅ Promoción popup creada: ${titulo}`);
    
    res.json({
      success: true,
      promocion: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error creando promoción popup:', error);
    res.status(500).json({ error: 'Error creando promoción' });
  }
});

// 🏷️ Gestión de descuentos por producto (admin)
app.put('/api/admin/productos/:id/descuento', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      descuento_activo, 
      descuento_porcentaje, 
      descuento_badge_texto 
    } = req.body;
    
    const result = await pool.query(
      `UPDATE productos SET 
        descuento_activo = $1,
        descuento_porcentaje = $2,
        descuento_badge_texto = $3,
        descuento_fecha_inicio = CASE WHEN $1 = TRUE THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = $4 
       RETURNING *`,
      [descuento_activo, descuento_porcentaje || 0, descuento_badge_texto, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    console.log(`✅ Descuento actualizado para producto ${id}: ${descuento_activo ? 'Activado' : 'Desactivado'}`);
    
    res.json({
      success: true,
      producto: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error actualizando descuento:', error);
    res.status(500).json({ error: 'Error actualizando descuento' });
  }
});

// 📄 Obtener productos con descuentos incluidos
app.get('/productos-con-descuentos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        *,
        CASE 
          WHEN descuento_activo = TRUE AND descuento_porcentaje > 0 
          THEN ROUND(precio * (100 - descuento_porcentaje) / 100, 0)
          ELSE precio 
        END as precio_final
      FROM productos 
      ORDER BY id DESC
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error obteniendo productos con descuentos:', error);
    res.status(500).json({ error: 'Error obteniendo productos' });
  }
});

// ===================
// 🎁 RUTAS DE PROMOCIONES
// Agregar ANTES del app.listen(3000, ...)
// ===================

app.post('/api/admin/codigos-promocionales/generar', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔥 ENDPOINT EJECUTADO - req.body:', req.body);
    
    const { cantidad = 2000, descuento = 10, tipo = 'bienvenida' } = req.body;
    
    console.log(`🎁 Generando ${cantidad} códigos tipo: ${tipo}, descuento: ${descuento}%`);
    
    const año = new Date().getFullYear();
    // 🆕 LETRA DINÁMICA SEGÚN TIPO
    const letra = tipo === 'general' ? 'G' : 
                  tipo === 'usuario_unico' ? 'U' : 'A';
    
    console.log(`📝 Usando letra: ${letra} para tipo: ${tipo}`);
    
    let nuevos = 0;
    let duplicados = 0;
    
    for (let i = 1; i <= cantidad; i++) {
      const numero = String(i).padStart(4, '0');
      const codigo = `SC${año}${letra}${numero}`;
      
      try {
        await pool.query(
          `INSERT INTO codigos_promocionales (codigo, descuento_porcentaje, activo, tipo) 
           VALUES ($1, $2, TRUE, $3)`,
          [codigo, descuento, tipo]
        );
        nuevos++;
      } catch (error) {
        if (error.code === '23505') { // Duplicate key
          duplicados++;
        } else {
          throw error;
        }
      }
    }
    
    console.log(`✅ Generación completada: ${nuevos} nuevos, ${duplicados} duplicados`);
    
    res.json({
      success: true,
      message: `Códigos ${tipo} generados exitosamente`,
      nuevos,
      duplicados,
      tipo
    });
    
  } catch (error) {
    console.error('❌ Error generando códigos:', error);
    res.status(500).json({ error: 'Error generando códigos' });
  }
});


// 📊 Obtener estadísticas de códigos (solo admin)
app.get('/api/admin/codigos-promocionales/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM codigos_promocionales'),
      pool.query('SELECT COUNT(*) as usados FROM codigos_promocionales WHERE usado = TRUE'),
      pool.query('SELECT COUNT(*) as disponibles FROM codigos_promocionales WHERE usado = FALSE AND activo = TRUE')
    ]);
    
    res.json({
      total: parseInt(stats[0].rows[0].total),
      usados: parseInt(stats[1].rows[0].usados),
      disponibles: parseInt(stats[2].rows[0].disponibles)
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// 🎁 Validar código promocional
app.post('/api/validar-codigo-promocional', authenticateToken, async (req, res) => {
  try {
    const { codigo } = req.body;
    const userId = req.user.userId;
    
    if (!codigo) {
      return res.status(400).json({ 
        valido: false, 
        error: 'Código requerido' 
      });
    }
    
    console.log(`🔍 Validando código: ${codigo} para usuario: ${userId}`);
    
    // Buscar código
    const codigoResult = await pool.query(
      'SELECT * FROM codigos_promocionales WHERE codigo = $1',
      [codigo.trim().toUpperCase()]
    );
    
    if (codigoResult.rows.length === 0) {
      return res.json({ 
        valido: false, 
        error: 'Código no válido' 
      });
    }
    
    const codigoData = codigoResult.rows[0];
    
    // Verificar si ya fue usado
    if (codigoData.usado) {
      return res.json({ 
        valido: false, 
        error: 'Este código ya fue utilizado' 
      });
    }
    
    // Verificar si está activo
    if (!codigoData.activo) {
      return res.json({ 
        valido: false, 
        error: 'Código no disponible' 
      });
    }
    
    // Verificar si es primera compra del usuario
    const pedidosUsuario = await pool.query(
      'SELECT COUNT(*) as total FROM pedidos WHERE usuario_id = $1 AND estado != $2',
      [userId, 'cancelado']
    );
    
    const esPrimeraCompra = parseInt(pedidosUsuario.rows[0].total) === 0;
    
    if (!esPrimeraCompra) {
      return res.json({ 
        valido: false, 
        error: 'Este descuento es solo para tu primera compra' 
      });
    }
    
    console.log(`✅ Código válido: ${codigo}, descuento: ${codigoData.descuento_porcentaje}%`);
    
    res.json({
      valido: true,
      codigo: codigoData.codigo,
      descuento: parseFloat(codigoData.descuento_porcentaje),
      mensaje: `¡Código válido! ${codigoData.descuento_porcentaje}% de descuento aplicado`
    });
    
  } catch (error) {
    console.error('❌ Error validando código:', error);
    res.status(500).json({ 
      valido: false, 
      error: 'Error validando código' 
    });
  }
});

// 💰 Aplicar código promocional al crear pedido
app.post('/api/aplicar-codigo-promocional', authenticateToken, async (req, res) => {
  try {
    const { codigo, pedido_id } = req.body;
    const userId = req.user.userId;
    
    // Marcar código como usado
    const result = await pool.query(
      `UPDATE codigos_promocionales 
       SET usado = TRUE, usuario_id = $1, fecha_uso = CURRENT_TIMESTAMP 
       WHERE codigo = $2 AND usado = FALSE 
       RETURNING *`,
      [userId, codigo.trim().toUpperCase()]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Código no válido o ya usado' });
    }
    
    console.log(`✅ Código ${codigo} marcado como usado para pedido ${pedido_id}`);
    
    res.json({
      success: true,
      message: 'Código aplicado exitosamente',
      codigo_usado: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error aplicando código:', error);
    res.status(500).json({ error: 'Error aplicando código promocional' });
  }
});

// 🖼️ Gestión de promociones popup (admin)
app.get('/api/promociones-popup', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM promociones_popup WHERE activo = TRUE AND (fecha_fin IS NULL OR fecha_fin > CURRENT_TIMESTAMP) ORDER BY fecha_inicio DESC LIMIT 1'
    );
    
    res.json({
      activa: result.rows.length > 0,
      promocion: result.rows[0] || null
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo promoción popup:', error);
    res.status(500).json({ error: 'Error obteniendo promoción' });
  }
});

app.post('/api/admin/promociones-popup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { titulo, descripcion, imagen_url } = req.body;
    
    // Desactivar promociones anteriores
    await pool.query('UPDATE promociones_popup SET activo = FALSE');
    
    // Crear nueva promoción
    const result = await pool.query(
      `INSERT INTO promociones_popup (titulo, descripcion, imagen_url, activo) 
       VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [titulo, descripcion, imagen_url]
    );
    
    console.log(`✅ Promoción popup creada: ${titulo}`);
    
    res.json({
      success: true,
      promocion: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error creando promoción popup:', error);
    res.status(500).json({ error: 'Error creando promoción' });
  }
});

// 🏷️ Gestión de descuentos por producto (admin)
app.put('/api/admin/productos/:id/descuento', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      descuento_activo, 
      descuento_porcentaje, 
      descuento_badge_texto 
    } = req.body;
    
    const result = await pool.query(
      `UPDATE productos SET 
        descuento_activo = $1,
        descuento_porcentaje = $2,
        descuento_badge_texto = $3,
        descuento_fecha_inicio = CASE WHEN $1 = TRUE THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = $4 
       RETURNING *`,
      [descuento_activo, descuento_porcentaje || 0, descuento_badge_texto, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    console.log(`✅ Descuento actualizado para producto ${id}: ${descuento_activo ? 'Activado' : 'Desactivado'}`);
    
    res.json({
      success: true,
      producto: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error actualizando descuento:', error);
    res.status(500).json({ error: 'Error actualizando descuento' });
  }
});

// 📄 Obtener productos con descuentos incluidos
app.get('/productos-con-descuentos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        *,
        CASE 
          WHEN descuento_activo = TRUE AND descuento_porcentaje > 0 
          THEN ROUND(precio * (100 - descuento_porcentaje) / 100, 0)
          ELSE precio 
        END as precio_final
      FROM productos 
      ORDER BY id DESC
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error obteniendo productos con descuentos:', error);
    res.status(500).json({ error: 'Error obteniendo productos' });
  }
});

// 🗑️ Eliminar códigos promocionales (solo admin)
app.delete('/api/admin/codigos-promocionales/eliminar', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { codigos, tipo_eliminacion } = req.body;
    
    let result;
    
    if (tipo_eliminacion === 'todos_no_usados') {
      // Eliminar todos los códigos no usados
      result = await pool.query(
        'DELETE FROM codigos_promocionales WHERE usado = FALSE'
      );
      console.log(`🗑️ Eliminados ${result.rowCount} códigos no usados`);
    } else if (tipo_eliminacion === 'por_tipo') {
      // Eliminar por tipo específico
      const { tipo } = req.body;
      result = await pool.query(
        'DELETE FROM codigos_promocionales WHERE tipo = $1 AND usado = FALSE',
        [tipo]
      );
      console.log(`🗑️ Eliminados ${result.rowCount} códigos tipo "${tipo}" no usados`);
    } else if (tipo_eliminacion === 'especificos' && codigos && codigos.length > 0) {
      // Eliminar códigos específicos
      const placeholders = codigos.map((_, index) => `$${index + 1}`).join(',');
      result = await pool.query(
        `DELETE FROM codigos_promocionales WHERE codigo IN (${placeholders})`,
        codigos
      );
      console.log(`🗑️ Eliminados ${result.rowCount} códigos específicos`);
    } else {
      return res.status(400).json({ error: 'Tipo de eliminación no válido' });
    }
    
    res.json({
      success: true,
      message: `${result.rowCount} códigos eliminados exitosamente`,
      eliminados: result.rowCount
    });
    
  } catch (error) {
    console.error('❌ Error eliminando códigos:', error);
    res.status(500).json({ error: 'Error eliminando códigos' });
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