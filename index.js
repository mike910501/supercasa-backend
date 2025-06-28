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
    password VARCHAR(255) NOT NULL,
    telefono VARCHAR(20),
    direccion TEXT,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rol VARCHAR(20) DEFAULT 'cliente'
  )
`).then(() => console.log("✅ Tabla 'usuarios' lista"))
  .catch(err => console.error("❌ Error creando tabla usuarios:", err));

// ✅ Crear tabla productos
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

// ✅ Actualizar tabla usuarios para incluir datos residenciales (Torres 1,2,3,4,5) - ⚡ ACTUALIZADO
pool.query(`
  ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS torre VARCHAR(1),
  ADD COLUMN IF NOT EXISTS piso INTEGER CHECK (piso >= 1 AND piso <= 30),
  ADD COLUMN IF NOT EXISTS apartamento VARCHAR(10),
  ADD COLUMN IF NOT EXISTS telefono_alternativo VARCHAR(20),
  ADD COLUMN IF NOT EXISTS notas_entrega TEXT
`).then(async () => {
  // ⚡ ACTUALIZAR: Constraint de torres para incluir Torre 5
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

// ✅ Actualizar tabla pedidos para entrega residencial (Torres 1,2,3,4,5) - ⚡ ACTUALIZADO
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
  // ⚡ ACTUALIZAR: Constraint de torres para incluir Torre 5
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

// ⚡ AGREGADO: Función de validación para datos residenciales
function validarDatosResidenciales(torre, piso, apartamento) {
  const errores = [];

  // Validar torre (ahora incluye Torre 5)
  if (!['1', '2', '3', '4', '5'].includes(String(torre))) {
    errores.push('Torre debe ser 1, 2, 3, 4 o 5');
  }

  // Validar piso
  const pisoNum = parseInt(piso);
  if (!piso || pisoNum < 1 || pisoNum > 30) {
    errores.push('El piso debe estar entre 1 y 30');
  }

  // Validar apartamento
  if (!apartamento || apartamento.length === 0) {
    errores.push('El apartamento es obligatorio');
  }

  return errores;
}

// 🛡️ Middleware de autenticación
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
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

// 📝 Registro de usuario con datos residenciales - ⚡ ACTUALIZADO
app.post('/auth/register', async (req, res) => {
  const { 
    nombre, 
    email, 
    password, 
    telefono, 
    telefono_alternativo,
    torre, 
    piso, 
    apartamento,
    notas_entrega 
  } = req.body;

  try {
    // ⚡ AGREGADO: Validar datos residenciales
    const erroresValidacion = validarDatosResidenciales(torre, piso, apartamento);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({ error: erroresValidacion.join(', ') });
    }

    // Validaciones básicas
    if (!nombre || !email || !password || !telefono) {
      return res.status(400).json({ error: 'Todos los campos obligatorios deben estar completos' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Verificar si el usuario ya existe
    const userExists = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Verificar si el apartamento ya está registrado
    const apartmentExists = await pool.query(
      'SELECT id FROM usuarios WHERE torre = $1 AND piso = $2 AND apartamento = $3', 
      [torre, piso, apartamento]
    );
    if (apartmentExists.rows.length > 0) {
      return res.status(400).json({ error: 'Este apartamento ya está registrado' });
    }

    // Encriptar contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Crear usuario
    const result = await pool.query(
      `INSERT INTO usuarios (
        nombre, email, password, telefono, telefono_alternativo, 
        torre, piso, apartamento, notas_entrega
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
      RETURNING id, nombre, email, telefono, torre, piso, apartamento, rol`,
      [nombre, email, hashedPassword, telefono, telefono_alternativo, torre, piso, apartamento, notas_entrega]
    );

    const user = result.rows[0];

    // Crear token JWT
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

// 🔑 Login de usuario
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Buscar usuario
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    // Crear token JWT
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
  const { nombre, precio, descripcion, nutricional, categoria, imagen } = req.body;
  try {
    await pool.query(
      'INSERT INTO productos (nombre, precio, descripcion, nutricional, categoria, imagen) VALUES ($1, $2, $3, $4, $5, $6)',
      [nombre, precio, descripcion, nutricional, categoria, imagen]
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
  const { nombre, precio, descripcion, nutricional, categoria, imagen } = req.body;

  try {
    await pool.query(
      'UPDATE productos SET nombre = $1, precio = $2, descripcion = $3, nutricional = $4, categoria = $5, imagen = $6 WHERE id = $7',
      [nombre, precio, descripcion, nutricional, categoria, imagen, id]
    );
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// ===================
// 🛍️ RUTAS DE PEDIDOS
// ===================

// 🛍️ Crear pedido con datos de entrega residencial - ⚡ ACTUALIZADO CON WOMPI
app.post('/orders', authenticateToken, async (req, res) => {
  const { 
    productos, 
    total, 
    torre_entrega, 
    piso_entrega, 
    apartamento_entrega,
    instrucciones_entrega,
    telefono_contacto,
    // 💳 NUEVOS CAMPOS WOMPI
    payment_reference,
    payment_status = 'PENDING',
    payment_method,
    payment_transaction_id,
    payment_amount_cents
  } = req.body;

  try {
    // ⚡ AGREGADO: Validar datos de entrega
    const erroresValidacion = validarDatosResidenciales(torre_entrega, piso_entrega, apartamento_entrega);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({ error: `Datos de entrega: ${erroresValidacion.join(', ')}` });
    }

    // Validaciones básicas
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

    // 💳 Validar referencia única de pago (si se proporciona)
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
        JSON.stringify(productos), 
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
      // Los admin ven todos los pedidos con info completa de entrega
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
      // Los usuarios solo ven sus propios pedidos
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

    // Verificar que el pedido pertenece al usuario o que sea admin
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

// ✏️ Actualizar estado de un pedido (solo admin) - RUTA ORIGINAL
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
      pool.query('SELECT COUNT(*) as pagos_aprobados FROM pedidos WHERE payment_status = $1', ['APPROVED'])
    ]);

    res.json({
      totalUsuarios: parseInt(stats[0].rows[0].total_usuarios),
      totalProductos: parseInt(stats[1].rows[0].total_productos),
      totalPedidos: parseInt(stats[2].rows[0].total_pedidos),
      ingresosTotales: parseInt(stats[3].rows[0].ingresos_totales) || 0,
      pedidosPendientes: parseInt(stats[4].rows[0].pedidos_pendientes),
      pagosAprobados: parseInt(stats[5].rows[0].pagos_aprobados)
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
      'SELECT id, nombre, email, telefono, direccion, rol, fecha_registro FROM usuarios ORDER BY fecha_registro DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo usuarios:', err);
    res.status(500).json({ error: 'Error obteniendo usuarios' });
  }
});

// 📊 Estadísticas específicas para conjunto residencial - ⚡ ACTUALIZADO
app.get('/admin/stats/residential', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      // Estadísticas por torre (ahora incluye Torre 5)
      pool.query(`
        SELECT torre_entrega, COUNT(*) as pedidos, SUM(total) as ventas
        FROM pedidos 
        WHERE torre_entrega IS NOT NULL
        GROUP BY torre_entrega
        ORDER BY torre_entrega
      `),
      // Pisos más activos
      pool.query(`
        SELECT piso_entrega, COUNT(*) as pedidos
        FROM pedidos 
        WHERE piso_entrega IS NOT NULL
        GROUP BY piso_entrega
        ORDER BY pedidos DESC
        LIMIT 5
      `),
      // Entregas pendientes por torre
      pool.query(`
        SELECT torre_entrega, COUNT(*) as pendientes
        FROM pedidos 
        WHERE estado = 'pendiente' AND torre_entrega IS NOT NULL
        GROUP BY torre_entrega
      `),
      // Usuarios registrados por torre (ahora incluye Torre 5)
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
// 🚀 NUEVAS RUTAS PARA GESTIÓN DE PEDIDOS
// ===================

// 📦 GET /api/admin/pedidos - Obtener todos los pedidos para gestión admin - ⚡ ACTUALIZADO
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

    // ⚡ ACTUALIZADO: Filtro de torre para incluir Torre 5
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
      // 💳 NUEVOS CAMPOS WOMPI
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

// 🔄 PUT /api/admin/pedidos/:id/estado - Actualizar estado del pedido
app.put('/api/admin/pedidos/:id/estado', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    
    const estadosValidos = ['pendiente', 'entregado', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }
    
    const fechaEntrega = estado === 'entregado' ? new Date() : null;
    const result = await pool.query(
      'UPDATE pedidos SET estado = $1, fecha_entrega = $2 WHERE id = $3 RETURNING *',
      [estado, fechaEntrega, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
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

// 🚀 Iniciar servidor - ⚡ ACTUALIZADO
app.listen(3000, () => {
  console.log('🚀 Backend corriendo en http://localhost:3000');
  console.log('🔐 Sistema de autenticación activado');
  console.log('🏢 Conjunto residencial: Torres 1, 2, 3, 4, 5');
  console.log('⚡ Entrega rápida: máximo 20 minutos');
  console.log('📦 API de gestión de pedidos lista');
  console.log('💳 Sistema de tracking WOMPI integrado');
  console.log('✅ Validaciones actualizadas para Torre 5');
});