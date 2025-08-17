import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import twilio from 'twilio';  // ← AGREGAR ESTA LÍNEA

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

// 🔐 JWT Secret (en producción, usar variable de entorno)
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura_2024';

// 🧠 Conexión a base de datos Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:tdeuoDrXTBJvFcCnbiehngvItJYFSdtX@gondola.proxy.rlwy.net:50352/railway",
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

  // FORZAR CREACIÓN DE CAMPOS QUE FALTAN
setTimeout(async () => {
  try {
    await pool.query(`
      ALTER TABLE pedidos
      ADD COLUMN IF NOT EXISTS codigo_promocional VARCHAR(50)
    `);
    console.log("✅✅✅ Campo codigo_promocional agregado FORZADAMENTE");
  } catch (err) {
    console.log("❌ Error agregando codigo_promocional:", err.message);
  }
}, 3000); // Esperar 3 segundos para que todo esté listo

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

  // ========================================
// 🏆 SISTEMA DE PUNTOS - CREAR TABLAS Y DATOS INICIALES
// ========================================

// 1. Tabla programa_puntos (si no existe)
pool.query(`
  CREATE TABLE IF NOT EXISTS programa_puntos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    puntos_totales INTEGER DEFAULT 0,
    puntos_disponibles INTEGER DEFAULT 0,
    puntos_canjeados INTEGER DEFAULT 0,
    puntos_expirados INTEGER DEFAULT 0,
    nivel VARCHAR(20) DEFAULT 'BRONCE',
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(usuario_id)
  )
`).then(() => console.log("✅ Tabla 'programa_puntos' lista"))
  .catch(err => console.error("❌ Error creando tabla programa_puntos:", err));

// 2. Tabla transacciones_puntos
pool.query(`
  CREATE TABLE IF NOT EXISTS transacciones_puntos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('GANADO', 'CANJEADO', 'EXPIRADO', 'BONUS', 'AJUSTE')),
    puntos INTEGER NOT NULL,
    descripcion TEXT,
    saldo_anterior INTEGER DEFAULT 0,
    saldo_nuevo INTEGER DEFAULT 0,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expira_en DATE,
    expirado BOOLEAN DEFAULT FALSE
  )
`).then(() => console.log("✅ Tabla 'transacciones_puntos' lista"))
  .catch(err => console.error("❌ Error creando tabla transacciones_puntos:", err));

// 3. Tabla niveles_programa
pool.query(`
  CREATE TABLE IF NOT EXISTS niveles_programa (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(20) UNIQUE NOT NULL,
    puntos_minimos INTEGER NOT NULL,
    multiplicador_puntos DECIMAL(3,2) DEFAULT 1.00,
    descuento_base INTEGER DEFAULT 0,
    beneficios JSONB,
    color_hex VARCHAR(7),
    icono VARCHAR(50),
    orden INTEGER
  )
`).then(async () => {
  console.log("✅ Tabla 'niveles_programa' lista");

  // Insertar niveles por defecto si no existen
pool.query('SELECT COUNT(*) as total FROM niveles_programa')
  .then(async (result) => {
    if (parseInt(result.rows[0].total) === 0) {
      await pool.query(`
        INSERT INTO niveles_programa (nombre, puntos_minimos, multiplicador_puntos, color_hex, icono, orden)
        VALUES 
          ('BRONCE', 0, 1.0, '#CD7F32', '🥉', 1),
          ('PLATA', 500, 1.2, '#C0C0C0', '🥈', 2),
          ('ORO', 1500, 1.5, '#FFD700', '🥇', 3)
      `);
      console.log("✅ Niveles de programa insertados");
    }
  })
  .catch(err => console.log("❌ Error con niveles:", err));

// Insertar configuración de puntos si no existe
pool.query(`
  CREATE TABLE IF NOT EXISTS configuracion_puntos (
    id SERIAL PRIMARY KEY,
    clave VARCHAR(50) UNIQUE NOT NULL,
    valor VARCHAR(100) NOT NULL,
    descripcion TEXT
  )
`).then(async () => {
  const configExistente = await pool.query('SELECT COUNT(*) as total FROM configuracion_puntos');
  
  if (parseInt(configExistente.rows[0].total) === 0) {
    await pool.query(`
      INSERT INTO configuracion_puntos (clave, valor, descripcion)
      VALUES 
        ('PUNTOS_POR_MIL_PESOS', '10', 'Puntos otorgados por cada $1000 gastados'),
        ('MONTO_MINIMO_PUNTOS', '15000', 'Monto mínimo para ganar puntos'),
        ('BONUS_COMPRA_GRANDE', '50', 'Puntos bonus por compras superiores a $50,000'),
        ('DIAS_EXPIRACION', '365', 'Días antes de que expiren los puntos')
    `);
    console.log("✅ Configuración de puntos insertada");
  }
}).catch(err => console.error("❌ Error con configuracion_puntos:", err));
  
  // Insertar niveles por defecto
  const nivelesExistentes = await pool.query('SELECT COUNT(*) as total FROM niveles_programa');
  
  if (parseInt(nivelesExistentes.rows[0].total) === 0) {
    await pool.query(`
      INSERT INTO niveles_programa (nombre, puntos_minimos, multiplicador_puntos, color_hex, icono, orden)
      VALUES 
        ('BRONCE', 0, 1.0, '#CD7F32', '🥉', 1),
        ('PLATA', 500, 1.2, '#C0C0C0', '🥈', 2),
        ('ORO', 1500, 1.5, '#FFD700', '🥇', 3)
    `);
    console.log("✅ Niveles de programa insertados");
  }
}).catch(err => console.error("❌ Error con niveles_programa:", err));

// 4. Tabla configuracion_puntos
pool.query(`
  CREATE TABLE IF NOT EXISTS configuracion_puntos (
    id SERIAL PRIMARY KEY,
    clave VARCHAR(50) UNIQUE NOT NULL,
    valor VARCHAR(100) NOT NULL,
    descripcion TEXT
  )
`).then(async () => {
  console.log("✅ Tabla 'configuracion_puntos' lista");
  
  // Insertar configuración por defecto
  const configExistente = await pool.query('SELECT COUNT(*) as total FROM configuracion_puntos');
  
  if (parseInt(configExistente.rows[0].total) === 0) {
    await pool.query(`
      INSERT INTO configuracion_puntos (clave, valor, descripcion)
      VALUES 
        ('PUNTOS_POR_MIL_PESOS', '10', 'Puntos otorgados por cada $1000 gastados'),
        ('MONTO_MINIMO_PUNTOS', '15000', 'Monto mínimo para ganar puntos'),
        ('BONUS_COMPRA_GRANDE', '50', 'Puntos bonus por compras superiores a $50,000'),
        ('DIAS_EXPIRACION', '365', 'Días antes de que expiren los puntos')
    `);
    console.log("✅ Configuración de puntos insertada");
  }
}).catch(err => console.error("❌ Error con configuracion_puntos:", err));

// 5. Tabla recompensas
pool.query(`
  CREATE TABLE IF NOT EXISTS recompensas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    puntos_requeridos INTEGER NOT NULL,
    tipo VARCHAR(30) CHECK (tipo IN ('DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO', 'ENVIO_GRATIS', 'PRODUCTO_GRATIS')),
    valor DECIMAL(10,2),
    nivel_minimo VARCHAR(20) DEFAULT 'BRONCE',
    categoria VARCHAR(50),
    stock INTEGER,
    stock_usado INTEGER DEFAULT 0,
    validez_dias INTEGER DEFAULT 30,
    activo BOOLEAN DEFAULT TRUE,
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_fin TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => console.log("✅ Tabla 'recompensas' lista"))
  .catch(err => console.error("❌ Error creando tabla recompensas:", err));

// 6. Tabla canjes_recompensas
pool.query(`
  CREATE TABLE IF NOT EXISTS canjes_recompensas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    recompensa_id INTEGER REFERENCES recompensas(id),
    puntos_usados INTEGER NOT NULL,
    codigo_canje VARCHAR(50) UNIQUE,
    estado VARCHAR(20) DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'USADO', 'EXPIRADO')),
    fecha_canje TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_uso TIMESTAMP,
    fecha_expiracion TIMESTAMP,
    pedido_id INTEGER REFERENCES pedidos(id),
    valor_descuento DECIMAL(10,2),
    notas TEXT
  )
`).then(() => console.log("✅ Tabla 'canjes_recompensas' lista"))
  .catch(err => console.error("❌ Error creando tabla canjes_recompensas:", err));

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

// ===================
// 🏆 SISTEMA DE PUNTOS - FUNCIONES AUXILIARES
// ===================

// Calcular puntos para un pedido
async function calcularPuntosParaPedido(pedido, usuarioId) {
  try {
    // Obtener configuración
    const configResult = await pool.query(
      "SELECT * FROM configuracion_puntos WHERE clave IN ('PUNTOS_POR_MIL_PESOS', 'BONUS_COMPRA_GRANDE', 'MONTO_MINIMO_PUNTOS')"
    );
    
    const config = {};
    configResult.rows.forEach(row => {
      config[row.clave] = parseFloat(row.valor);
    });
    
    // Verificar monto mínimo
    if (pedido.total < (config.MONTO_MINIMO_PUNTOS || 15000)) {
      console.log(`📊 Pedido ${pedido.id} no alcanza monto mínimo para puntos`);
      return 0;
    }
    
    // Obtener multiplicador del usuario
    const nivelResult = await pool.query(`
      SELECT np.multiplicador_puntos 
      FROM programa_puntos pp
      JOIN niveles_programa np ON pp.nivel = np.nombre
      WHERE pp.usuario_id = $1
    `, [usuarioId]);
    
    const multiplicador = nivelResult.rows[0]?.multiplicador_puntos || 1.0;
    
    // Calcular puntos base
    const puntosPorMil = config.PUNTOS_POR_MIL_PESOS || 1;
    const puntosBase = Math.floor(pedido.total / 1000) * puntosPorMil;
    
    // Aplicar multiplicador
    let puntosTotales = Math.floor(puntosBase * multiplicador);
    
    // Bonus por compra grande
    if (pedido.total >= 50000) {
      puntosTotales += parseInt(config.BONUS_COMPRA_GRANDE || 50);
    }
    
    console.log(`🎯 Puntos calculados para pedido ${pedido.id}: ${puntosTotales}`);
    return puntosTotales;
    
  } catch (error) {
    console.error('❌ Error calculando puntos:', error);
    return 0;
  }
}

// Asignar puntos a usuario
async function asignarPuntosUsuario(usuarioId, pedidoId, puntos, descripcion = 'Compra en SuperCasa') {
  try {
    if (puntos <= 0) return false;
    
    // Verificar si el usuario tiene perfil de puntos
    const perfilResult = await pool.query(
      'SELECT * FROM programa_puntos WHERE usuario_id = $1',
      [usuarioId]
    );
    
    if (perfilResult.rows.length === 0) {
      // Crear perfil de puntos si no existe
      await pool.query(
        'INSERT INTO programa_puntos (usuario_id) VALUES ($1)',
        [usuarioId]
      );
    }
    
    // Obtener saldo actual
    const saldoResult = await pool.query(
      'SELECT puntos_disponibles, puntos_totales FROM programa_puntos WHERE usuario_id = $1',
      [usuarioId]
    );
    
    const saldoAnterior = saldoResult.rows[0]?.puntos_disponibles || 0;
    const saldoNuevo = saldoAnterior + puntos;
    
    // Registrar transacción
    const fechaExpiracion = new Date();
    fechaExpiracion.setFullYear(fechaExpiracion.getFullYear() + 1);
    
    await pool.query(`
      INSERT INTO transacciones_puntos 
      (usuario_id, pedido_id, tipo, puntos, descripcion, saldo_anterior, saldo_nuevo, expira_en)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [usuarioId, pedidoId, 'GANADO', puntos, descripcion, saldoAnterior, saldoNuevo, fechaExpiracion]);
    
    // Actualizar saldo en programa_puntos
    await pool.query(`
      UPDATE programa_puntos 
      SET puntos_disponibles = puntos_disponibles + $1,
          puntos_totales = puntos_totales + $1,
          ultima_actualizacion = CURRENT_TIMESTAMP
      WHERE usuario_id = $2
    `, [puntos, usuarioId]);
    
    // Verificar y actualizar nivel
    await actualizarNivelUsuario(usuarioId);
    
    console.log(`✅ ${puntos} puntos asignados a usuario ${usuarioId}`);
    return true;
    
  } catch (error) {
    console.error('❌ Error asignando puntos:', error);
    return false;
  }
}

// Actualizar nivel del usuario
async function actualizarNivelUsuario(usuarioId) {
  try {
    const puntosResult = await pool.query(
      'SELECT puntos_totales FROM programa_puntos WHERE usuario_id = $1',
      [usuarioId]
    );
    
    const puntosTotales = puntosResult.rows[0]?.puntos_totales || 0;
    
    // Obtener nuevo nivel
    const nivelResult = await pool.query(`
      SELECT nombre FROM niveles_programa 
      WHERE puntos_minimos <= $1 
      ORDER BY puntos_minimos DESC 
      LIMIT 1
    `, [puntosTotales]);
    
    const nuevoNivel = nivelResult.rows[0]?.nombre || 'BRONCE';
    
    // Actualizar si cambió
    await pool.query(
      'UPDATE programa_puntos SET nivel = $1 WHERE usuario_id = $2',
      [nuevoNivel, usuarioId]
    );
    
    return nuevoNivel;
    
  } catch (error) {
    console.error('❌ Error actualizando nivel:', error);
    return null;
  }
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


// ===================================
// 🚚 ENDPOINT CALCULAR COSTO DE ENVÍO
// ===================================
app.post('/api/calcular-envio', authenticateToken, async (req, res) => {
  try {
    const { subtotal, metodoPago } = req.body;
    
    console.log(`🚚 REQUEST calcular envío - Subtotal: $${subtotal}, Método: ${metodoPago}`);
    
    // Validar datos de entrada
    if (!subtotal || subtotal <= 0) {
      return res.status(400).json({ error: 'Subtotal inválido' });
    }
    
    if (!metodoPago || !['efectivo', 'digital'].includes(metodoPago)) {
      return res.status(400).json({ error: 'Método de pago inválido' });
    }
    
    // Calcular envío usando nuestra función
    const resultado = calcularCostoEnvio(subtotal, metodoPago);
    
    // Si hay error (monto mínimo)
    if (resultado.error) {
      return res.status(400).json({ 
        error: resultado.error,
        codigo: resultado.codigo 
      });
    }
    
    // Calcular total final
    const total = subtotal + resultado.costoEnvio;
    
    // Respuesta exitosa
    res.json({
      subtotal: Number(subtotal),
      costoEnvio: resultado.costoEnvio,
      total: total,
      mensaje: resultado.mensaje,
      envioGratis: resultado.envioGratis,
      metodoPago: metodoPago
    });
    
    console.log(`✅ Envío calculado - Costo: $${resultado.costoEnvio}, Total: $${total}`);
    
  } catch (error) {
    console.error('❌ Error calculando envío:', error);
    res.status(500).json({ error: 'Error interno calculando costo de envío' });
  }
});

// ====================================
// 🎁 RUTAS DE PAQUETES SUPERCASA
// ====================================
// Agregar DESPUÉS de las rutas de productos existentes en index.js

// 📦 Obtener todos los paquetes activos (público)
app.get('/paquetes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM vista_paquetes_completos 
      WHERE activo = true 
      AND (fecha_inicio IS NULL OR fecha_inicio <= NOW())
      AND (fecha_fin IS NULL OR fecha_fin >= NOW())
      ORDER BY categoria, nombre
    `);
    
    res.json({
      success: true,
      paquetes: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('❌ Error obteniendo paquetes:', error);
    res.status(500).json({ error: 'Error obteniendo paquetes' });
  }
});

// 📦 Obtener paquete específico con productos
app.get('/paquetes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM vista_paquetes_completos 
      WHERE id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paquete no encontrado' });
    }
    
    res.json({
      success: true,
      paquete: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error obteniendo paquete:', error);
    res.status(500).json({ error: 'Error obteniendo paquete' });
  }
});

// 🎁 Crear paquete (solo admin)
app.post('/api/admin/paquetes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { 
      nombre, 
      descripcion, 
      precio_paquete, 
      categoria, 
      imagen, 
      productos, // Array de {producto_id, cantidad}
      fecha_inicio,
      fecha_fin
    } = req.body;

    if (!nombre || !precio_paquete || !productos || productos.length === 0) {
      return res.status(400).json({ 
        error: 'Nombre, precio y productos son obligatorios' 
      });
    }

    // Validar que todos los productos existen
    const productosIds = productos.map(p => p.producto_id);
    const productosValidacion = await pool.query(
      `SELECT id, nombre, stock FROM productos WHERE id = ANY($1)`,
      [productosIds]
    );

    if (productosValidacion.rows.length !== productos.length) {
      return res.status(400).json({ 
        error: 'Algunos productos no existen' 
      });
    }

    // Transacción para crear paquete y relaciones
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Crear paquete
      // Crear paquete (manejar fechas vacías)
const fechaInicioFormatted = fecha_inicio && fecha_inicio.trim() !== '' ? fecha_inicio : null;
const fechaFinFormatted = fecha_fin && fecha_fin.trim() !== '' ? fecha_fin : null;

const paqueteResult = await client.query(`
  INSERT INTO paquetes (nombre, descripcion, precio_paquete, categoria, imagen, fecha_inicio, fecha_fin)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING id
`, [nombre, descripcion, precio_paquete, categoria, imagen, fechaInicioFormatted, fechaFinFormatted]);

      const paqueteId = paqueteResult.rows[0].id;

      // Crear relaciones con productos
      for (const prod of productos) {
        await client.query(`
          INSERT INTO paquete_productos (paquete_id, producto_id, cantidad)
          VALUES ($1, $2, $3)
        `, [paqueteId, prod.producto_id, prod.cantidad]);
      }

      await client.query('COMMIT');
      
      console.log(`✅ Paquete creado: ${nombre} (ID: ${paqueteId})`);
      
      res.json({ 
        success: true, 
        paquete_id: paqueteId,
        message: 'Paquete creado exitosamente'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error creando paquete:', error);
    res.status(500).json({ error: 'Error creando paquete' });
  }
});

// ✏️ Actualizar paquete (solo admin)
app.put('/api/admin/paquetes/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      nombre, 
      descripcion, 
      precio_paquete, 
      categoria, 
      imagen, 
      activo,
      productos,
      fecha_inicio,
      fecha_fin
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Actualizar paquete
      await client.query(`
        UPDATE paquetes 
        SET nombre = $1, descripcion = $2, precio_paquete = $3, categoria = $4, 
            imagen = $5, activo = $6, fecha_inicio = $7, fecha_fin = $8, updated_at = NOW()
        WHERE id = $9
      `, [nombre, descripcion, precio_paquete, categoria, imagen, activo, fecha_inicio, fecha_fin, id]);

      // Si se proporcionaron productos, actualizar relaciones
      if (productos && Array.isArray(productos)) {
        // Eliminar relaciones existentes
        await client.query('DELETE FROM paquete_productos WHERE paquete_id = $1', [id]);
        
        // Crear nuevas relaciones
        for (const prod of productos) {
          await client.query(`
            INSERT INTO paquete_productos (paquete_id, producto_id, cantidad)
            VALUES ($1, $2, $3)
          `, [id, prod.producto_id, prod.cantidad]);
        }
      }

      await client.query('COMMIT');
      
      res.json({ 
        success: true,
        message: 'Paquete actualizado exitosamente'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error actualizando paquete:', error);
    res.status(500).json({ error: 'Error actualizando paquete' });
  }
});

// 🗑️ Eliminar paquete (solo admin)
app.delete('/api/admin/paquetes/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query('DELETE FROM paquetes WHERE id = $1', [id]);
    
    res.json({ 
      success: true,
      message: 'Paquete eliminado exitosamente'
    });
  } catch (error) {
    console.error('❌ Error eliminando paquete:', error);
    res.status(500).json({ error: 'Error eliminando paquete' });
  }
});

// 📊 Obtener estadísticas de paquetes (admin)
app.get('/api/admin/paquetes/estadisticas', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) as total_paquetes FROM paquetes'),
      pool.query('SELECT COUNT(*) as paquetes_activos FROM paquetes WHERE activo = true'),
      pool.query('SELECT COUNT(*) as paquetes_sin_stock FROM vista_paquetes_completos WHERE stock_paquetes_disponibles = 0'),
      pool.query('SELECT AVG(ahorro_porcentaje) as ahorro_promedio FROM vista_paquetes_completos WHERE activo = true')
    ]);

    res.json({
      totalPaquetes: parseInt(stats[0].rows[0].total_paquetes),
      paquetesActivos: parseInt(stats[1].rows[0].paquetes_activos),
      paquetesSinStock: parseInt(stats[2].rows[0].paquetes_sin_stock),
      ahorroPromedio: parseFloat(stats[3].rows[0].ahorro_promedio) || 0
    });
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de paquetes:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// ====================================
// 🛠️ MODIFICAR LA FUNCIÓN DE CREAR PEDIDOS EXISTENTE
// ====================================
// REEMPLAZAR la función app.post('/orders') existente con esta versión mejorada:

app.post('/orders', authenticateToken, async (req, res) => {
  const {
    productos,
    paquetes = [], // NUEVO: Array de paquetes
    total,
    codigo_promocional,
    codigo_canje,
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
    // Validaciones existentes (mantener tu código actual)
    const erroresValidacion = validarDatosResidenciales(torre_entrega, piso_entrega, apartamento_entrega);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({ error: `Datos de entrega: ${erroresValidacion.join(', ')}` });
    }

    if ((!productos || productos.length === 0) && (!paquetes || paquetes.length === 0)) {
      return res.status(400).json({ error: 'El pedido debe tener al menos un producto o paquete' });
    }

    if (!telefono_contacto) {
      return res.status(400).json({ error: 'El teléfono de contacto es obligatorio' });
    }

    let totalFinal = Math.round(Number(total));
    
    // Aplicar código promocional (mantener tu lógica existente)
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
        //totalFinal = totalFinal - descuentoMonto;
        console.log(`✅ Descuento aplicado: ${descuento}% = $${descuentoMonto}`);
      }
    }

    // 🎁 SISTEMA DE PUNTOS - Aplicar canje si existe
let canjeAplicado = null; // Variable para guardar el canje aplicado


    // ✅ VERIFICAR STOCK (productos individuales + paquetes)
    console.log('🔍 Verificando stock de productos y paquetes...');
    const erroresStock = [];
    const productosCompletos = [];

    // Verificar productos individuales (mantener tu lógica existente)
    if (productos && productos.length > 0) {
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

        productosCompletos.push({
          ...item,
          tipo: 'producto',
          nombre: producto.nombre,
          precio: producto.precio,
          codigo: producto.codigo
        });
      }
    }

    // 🎁 VERIFICAR STOCK DE PAQUETES
    if (paquetes && paquetes.length > 0) {
      for (const paqueteItem of paquetes) {
        console.log(`🎁 Verificando paquete ID: ${paqueteItem.id}`);
        
        // Obtener productos del paquete
        const paqueteInfo = await pool.query(`
          SELECT * FROM vista_paquetes_completos WHERE id = $1
        `, [paqueteItem.id]);

        if (paqueteInfo.rows.length === 0) {
          erroresStock.push(`Paquete ID ${paqueteItem.id} no encontrado`);
          continue;
        }

        const paquete = paqueteInfo.rows[0];
        const cantidadPaquetes = paqueteItem.cantidad || 1;

        // Verificar stock de cada producto del paquete
        const productosDelPaquete = paquete.productos_incluidos;
        
        for (const prodPaquete of productosDelPaquete) {
          const stockRequerido = prodPaquete.cantidad * cantidadPaquetes;
          
          if (prodPaquete.stock < stockRequerido) {
            erroresStock.push(`Paquete "${paquete.nombre}": Stock insuficiente de ${prodPaquete.nombre} (disponible: ${prodPaquete.stock}, requerido: ${stockRequerido})`);
          }
        }

        productosCompletos.push({
          ...paqueteItem,
          tipo: 'paquete',
          nombre: paquete.nombre,
          precio: paquete.precio_paquete,
          codigo: `PAQ-${paquete.id}`,
          productos_incluidos: productosDelPaquete
        });
      }
    }

    if (erroresStock.length > 0) {
      console.log('❌ Errores de stock:', erroresStock);
      return res.status(400).json({
        error: 'Stock insuficiente',
        detalles: erroresStock
      });
    }

    // ✅ REDUCIR STOCK
    console.log('📦 Reduciendo stock de productos y paquetes...');

    // Reducir stock de productos individuales (mantener tu lógica)
    if (productos && productos.length > 0) {
      for (const item of productos) {
        const cantidadSolicitada = item.cantidad || 1;
        await pool.query(
          'UPDATE productos SET stock = GREATEST(stock - $1, 0) WHERE id = $2',
          [cantidadSolicitada, item.id]
        );
        console.log(`📉 Stock reducido: Producto ID ${item.id}, cantidad: ${cantidadSolicitada}`);
      }
    }

    // 🎁 Reducir stock de productos en paquetes
    if (paquetes && paquetes.length > 0) {
      for (const paqueteItem of paquetes) {
        const cantidadPaquetes = paqueteItem.cantidad || 1;
        
        // Obtener productos del paquete
        const productosDelPaquete = await pool.query(`
          SELECT pp.producto_id, pp.cantidad
          FROM paquete_productos pp
          WHERE pp.paquete_id = $1
        `, [paqueteItem.id]);

        // Reducir stock de cada producto
        for (const prodRelacion of productosDelPaquete.rows) {
          const cantidadAReducir = prodRelacion.cantidad * cantidadPaquetes;
          
          await pool.query(
            'UPDATE productos SET stock = GREATEST(stock - $1, 0) WHERE id = $2',
            [cantidadAReducir, prodRelacion.producto_id]
          );
          
          console.log(`📉 Stock paquete reducido: Producto ID ${prodRelacion.producto_id}, cantidad: ${cantidadAReducir}`);
        }
      }
    }

    // Crear pedido (mantener tu lógica existente pero con productos completos)
    const result = await pool.query(`
      INSERT INTO pedidos (
        usuario_id, productos, total, torre_entrega, piso_entrega, apartamento_entrega,
        instrucciones_entrega, telefono_contacto, payment_reference, payment_status,
        payment_method, payment_transaction_id, payment_amount_cents,
        codigo_promocional, codigo_canje, subtotal, descuento_monto, costo_envio
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id
    `, [
      req.user.userId,                      // $1
      JSON.stringify(productosCompletos),   // $2
      totalFinal,                           // $3
      torre_entrega,                        // $4
      piso_entrega,                         // $5
      apartamento_entrega,                  // $6
      instrucciones_entrega || '',          // $7
      telefono_contacto,                    // $8
      payment_reference,                    // $9
      payment_status,                       // $10
      payment_method,                       // $11
      payment_transaction_id,               // $12
      payment_amount_cents,                 // $13
      req.body.codigo_promocional || null,  // $14
      req.body.codigo_canje || null,        // $15
      totalFinal,                           // $16 - subtotal
      0,                                     // $17 - descuento_monto
      0                                      // $18 - costo_envio
    ]);

    // Marcar código promocional como usado (mantener tu lógica)
    if (codigo_promocional) {
      const codigoResult = await pool.query(
        'SELECT id FROM codigos_promocionales WHERE codigo = $1 AND usado = FALSE',
        [codigo_promocional.trim().toUpperCase()]
      );
      if (codigoResult.rows.length > 0) {
        await pool.query(
          'UPDATE codigos_promocionales SET usado = TRUE, usuario_id = $1, fecha_uso = NOW() WHERE id = $2',
          [req.user.userId, codigoResult.rows[0].id]
        );
      }
    }

const pedidoId = result.rows[0].id;

let canjeInfo = null; 

// 🎯 APLICAR CANJE DE PUNTOS SI EXISTE
if (codigo_canje) {
  // PRIMERO: Verificar que el canje existe y es válido
  const canjeInfo = await pool.query(`
    SELECT * FROM canjes_recompensas 
    WHERE codigo_canje = $1 
    AND usuario_id = $2 
    AND estado = 'ACTIVO'
    AND fecha_expiracion > NOW()
  `, [codigo_canje, req.user.userId]);
  
  if (canjeInfo.rows.length > 0) {
    const puntosUsados = canjeInfo.rows[0].puntos_usados;
    
    // AHORA SÍ: Marcar el canje como USADO
    await pool.query(`
      UPDATE canjes_recompensas 
      SET estado = 'USADO', 
          fecha_uso = CURRENT_TIMESTAMP,
          pedido_id = $1
      WHERE codigo_canje = $2 AND usuario_id = $3
    `, [pedidoId, codigo_canje, req.user.userId]);
    
    // Actualizar puntos del usuario
    //await pool.query(`
      //UPDATE programa_puntos 
     // SET puntos_disponibles = puntos_disponibles - $1,
       //   puntos_canjeados = puntos_canjeados + $1,
         // ultima_actualizacion = CURRENT_TIMESTAMP
      //WHERE usuario_id = $2
    //`, [puntosUsados, req.user.userId]);
    
    // Registrar transacción de puntos
    await pool.query(`
      INSERT INTO transacciones_puntos 
      (usuario_id, tipo, puntos, descripcion, pedido_id)
      VALUES ($1, 'CANJEADO', $2, $3, $4)
    `, [
      req.user.userId,
      -puntosUsados,
      `Canje aplicado en pedido SUP-${pedidoId}`,
      pedidoId
    ]);
    
    // AGREGAR ESTAS LÍNEAS - Actualizar puntos del usuario
    await pool.query(`
      UPDATE programa_puntos
      SET puntos_disponibles = puntos_disponibles - $1,
          puntos_canjeados = puntos_canjeados + $1,
          ultima_actualizacion = CURRENT_TIMESTAMP
      WHERE usuario_id = $2
    `, [puntosUsados, req.user.userId]);
    // FIN DE LO QUE AGREGAR

    console.log(`✅ Canje ${codigo_canje} aplicado y ${puntosUsados} puntos descontados`);
    
    console.log(`✅ Canje ${codigo_canje} aplicado y ${puntosUsados} puntos descontados`);
  } else {
    console.log(`⚠️ Código de canje no válido o ya usado: ${codigo_canje}`);
  }
}
// Marcar canje de puntos como usado si se aplicó
if (req.body.codigo_canje) {
  await pool.query(`
    UPDATE canjes_recompensas 
    SET estado = 'USADO', 
        fecha_uso = CURRENT_TIMESTAMP,
        pedido_id = $1
    WHERE codigo_canje = $2 AND usuario_id = $3
  `, [pedidoId, req.body.codigo_canje, req.user.userId]);
  
  console.log(`🎁 Canje ${req.body.codigo_canje} marcado como usado`);
}
console.log(`✅ Pedido creado: SUP-${pedidoId} con productos y paquetes`);

// 🏆 SISTEMA DE PUNTOS - Calcular y asignar puntos
try {
  // NO ganar puntos si se usó un canje
  if (req.body.codigo_canje) {
    console.log('❌ No se ganan puntos al usar canje');
  } else {
    const puntosGanados = await calcularPuntosParaPedido(
      { id: pedidoId, total: totalFinal },
      req.user.userId
    );
    
    if (puntosGanados > 0) {
    await asignarPuntosUsuario(
      req.user.userId,
      pedidoId,
      puntosGanados,
      `Compra #SUP-${pedidoId}`
    );
    console.log(`🏆 ${puntosGanados} puntos asignados por pedido SUP-${pedidoId}`);
  }
  }
} catch (puntosError) {
  console.error('❌ Error en sistema de puntos (no crítico):', puntosError);
  // No interrumpir el pedido si falla el sistema de puntos
}

// ✅ ENVIAR CONFIRMACIÓN WHATSAPP
console.log('📱 Preparando confirmación WhatsApp...');

const pedidoCompleto = {
  id: pedidoId,
  numero_pedido: `SUP-${pedidoId}`,
  total: totalFinal,
  telefono_contacto: telefono_contacto,
  torre_entrega: torre_entrega,
  piso_entrega: piso_entrega,
  apartamento_entrega: apartamento_entrega,
  productos: productosCompletos,
  cantidadItems: productosCompletos.reduce((sum, item) => sum + (item.cantidad || 1), 0)
};

try {
  const whatsappResult = await enviarConfirmacionWhatsApp(pedidoCompleto);
  console.log('📱 WhatsApp result:', whatsappResult);
} catch (whatsappError) {
  console.error('❌ Error WhatsApp (no crítico):', whatsappError);
}

res.status(201).json({
  success: true,
  pedidoId: pedidoId,
  numero_pedido: `SUP-${pedidoId}`,
  total: totalFinal,
  productos: productosCompletos.length,
  message: 'Pedido creado exitosamente'
});

  } catch (err) {
    console.error('❌ Error guardando pedido:', err);
    res.status(500).json({ error: 'Error guardando pedido' });
  }
});

// ===================
// 💰 SISTEMA DE MÁRGENES Y COSTOS - SUPERCASA
// ===================

// 📊 Dashboard de rentabilidad con RANGOS DE TIEMPO
app.get('/api/admin/rentabilidad/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // 📅 OBTENER PARÁMETROS DE FECHA
    const { periodo = 'mes', fechaInicio, fechaFin } = req.query;
    
    let whereClause = '';
    let whereParams = [];
    let periodoTexto = '';
    
    // Configurar el filtro según el período seleccionado
    switch(periodo) {
      case '24h':
        whereClause = "fecha >= NOW() - INTERVAL '24 hours'";
        periodoTexto = 'Últimas 24 horas';
        break;
      
      case 'semana':
        whereClause = "fecha >= NOW() - INTERVAL '7 days'";
        periodoTexto = 'Última semana';
        break;
      
      case 'mes':
        whereClause = "DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE)";
        periodoTexto = 'Mes actual';
        break;
      
      case 'mesAnterior':
        whereClause = "DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')";
        periodoTexto = 'Mes anterior';
        break;
      
      case 'personalizado':
        if (fechaInicio && fechaFin) {
          whereClause = "fecha >= $1 AND fecha <= $2";
          whereParams = [fechaInicio, fechaFin + ' 23:59:59'];
          periodoTexto = `Del ${fechaInicio} al ${fechaFin}`;
        } else {
          whereClause = "DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE)";
          periodoTexto = 'Mes actual (fechas no válidas)';
        }
        break;
      
      case 'año':
        whereClause = "DATE_TRUNC('year', fecha) = DATE_TRUNC('year', CURRENT_DATE)";
        periodoTexto = 'Año actual';
        break;
      
      default:
        whereClause = "DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE)";
        periodoTexto = 'Mes actual';
    }
    
    console.log(`📊 Obteniendo rentabilidad: ${periodoTexto}`);
    
    // Obtener ventas del día (siempre muestra hoy)
    const ventasHoy = await pool.query(`
      SELECT 
        COUNT(*) as total_pedidos,
        COALESCE(SUM(total), 0) as ventas_total,
        COALESCE(AVG(total), 0) as ticket_promedio
      FROM pedidos 
      WHERE DATE(fecha) = CURRENT_DATE 
      AND estado != 'cancelado'
    `);

    // Obtener ventas del PERÍODO SELECCIONADO
    const queryVentasPeriodo = `
      SELECT 
        COUNT(*) as total_pedidos,
        COALESCE(SUM(total), 0) as ventas_total,
        COALESCE(AVG(total), 0) as ticket_promedio,
        MIN(fecha) as fecha_inicio,
        MAX(fecha) as fecha_fin
      FROM pedidos 
      WHERE ${whereClause}
      AND estado != 'cancelado'
    `;
    
    const ventasPeriodo = await pool.query(queryVentasPeriodo, whereParams);

    // Obtener gastos operativos (prorrateados según el período)
    const gastos = await pool.query(`
      SELECT 
        tipo,
        COALESCE(SUM(monto), 0) as total_gastos
      FROM gastos_operativos 
      WHERE activo = TRUE
      GROUP BY tipo
    `);

    // CALCULAR FACTOR DE PRORRATEO PARA GASTOS
    let factorProrrateo = 1;
    switch(periodo) {
      case '24h':
        factorProrrateo = 1/30; // 1 día de 30
        break;
      case 'semana':
        factorProrrateo = 7/30; // 7 días de 30
        break;
      case 'mes':
      case 'mesAnterior':
        factorProrrateo = 1; // Mes completo
        break;
      case 'año':
        factorProrrateo = 12; // 12 meses
        break;
      case 'personalizado':
        if (fechaInicio && fechaFin) {
          const dias = Math.ceil((new Date(fechaFin) - new Date(fechaInicio)) / (1000 * 60 * 60 * 24)) + 1;
          factorProrrateo = dias / 30;
        }
        break;
    }

    // 🎯 CALCULAR MARGEN PROMEDIO REAL
    const margenPromedio = await pool.query(`
      SELECT 
        AVG((precio - costo_compra)::DECIMAL / precio * 100) as margen_promedio,
        COUNT(*) as productos_con_costo
      FROM productos
      WHERE costo_compra IS NOT NULL 
      AND costo_compra > 0 
      AND precio > 0
    `);

    const margenPromedioReal = parseFloat(margenPromedio.rows[0]?.margen_promedio || 30);
    const productosConCosto = parseInt(margenPromedio.rows[0]?.productos_con_costo || 0);

    // 🎯 CALCULAR COSTO REAL DE PRODUCTOS VENDIDOS EN EL PERÍODO
    const queryCostosReales = `
      WITH ventas_periodo AS (
        SELECT 
          jsonb_array_elements(productos::jsonb) as producto
        FROM pedidos
        WHERE ${whereClause}
        AND estado != 'cancelado'
      ),
      productos_vendidos AS (
        SELECT 
          (producto->>'id')::INTEGER as producto_id,
          (producto->>'nombre')::TEXT as nombre,
          (producto->>'precio')::NUMERIC as precio_venta,
          (producto->>'cantidad')::INTEGER as cantidad
        FROM ventas_periodo
      )
      SELECT 
        SUM(
          CASE 
            WHEN p.costo_compra IS NOT NULL AND p.costo_compra > 0 
            THEN p.costo_compra * pv.cantidad
            ELSE pv.precio_venta * pv.cantidad * (1 - ${margenPromedioReal/100})
          END
        ) as costo_total,
        SUM(pv.precio_venta * pv.cantidad) as venta_total,
        COUNT(DISTINCT pv.producto_id) as productos_diferentes,
        SUM(pv.cantidad) as unidades_vendidas
      FROM productos_vendidos pv
      LEFT JOIN productos p ON p.id = pv.producto_id
    `;

    const costosReales = await pool.query(queryCostosReales, whereParams);
    const datosVentas = costosReales.rows[0];
    const costoTotalProductos = parseInt(datosVentas?.costo_total || 0);
    
    // Productos con margen bajo
    const productosAlerta = await pool.query(`
      SELECT 
        id,
        nombre, 
        precio, 
        costo_compra,
        stock,
        CASE 
          WHEN costo_compra IS NOT NULL AND costo_compra > 0 
          THEN ROUND(((precio - costo_compra)::DECIMAL / precio) * 100, 2)
          ELSE NULL
        END as margen_porcentaje,
        CASE
          WHEN costo_compra IS NULL THEN 'sin_costo'
          WHEN precio <= costo_compra THEN 'perdida'
          WHEN ((precio - costo_compra)::DECIMAL / precio) < 0.15 THEN 'margen_bajo'
          ELSE 'ok'
        END as estado
      FROM productos
      WHERE (costo_compra IS NOT NULL AND precio <= costo_compra) 
         OR (costo_compra IS NOT NULL AND ((precio - costo_compra)::DECIMAL / precio) < 0.15)
      ORDER BY 
        CASE 
          WHEN precio <= costo_compra THEN 0
          ELSE 1
        END,
        nombre
      LIMIT 10
    `);

    // Calcular totales con prorrateo
    const totalGastosFijos = parseInt(gastos.rows.find(g => g.tipo === 'fijo')?.total_gastos || 0);
    const totalGastosVariables = parseInt(gastos.rows.find(g => g.tipo === 'variable')?.total_gastos || 0);
    const gastosOriginales = totalGastosFijos + totalGastosVariables;
    const totalGastos = Math.round(gastosOriginales * factorProrrateo);
    
    // Ventas y cálculos finales
    const ventasPeriodoTotal = parseInt(ventasPeriodo.rows[0].ventas_total || 0);
    const costoFinal = costoTotalProductos > 0 ? costoTotalProductos : Math.round(ventasPeriodoTotal * (1 - margenPromedioReal/100));
    
    // CÁLCULOS FINALES
    const utilidadBruta = ventasPeriodoTotal - costoFinal;
    const utilidadNeta = utilidadBruta - totalGastos;
    const margenBrutoReal = ventasPeriodoTotal > 0 ? ((utilidadBruta / ventasPeriodoTotal) * 100) : 0;
    const margenNeto = ventasPeriodoTotal > 0 ? ((utilidadNeta / ventasPeriodoTotal) * 100) : 0;

    console.log(`
    =====================================
    📊 RENTABILIDAD: ${periodoTexto}
    =====================================
    Ventas período:        $${ventasPeriodoTotal.toLocaleString()}
    Costo de productos:    $${costoFinal.toLocaleString()}
    Margen bruto:          ${margenBrutoReal.toFixed(2)}%
    Utilidad bruta:        $${utilidadBruta.toLocaleString()}
    -------------------------------------
    Gastos (prorrateados): $${totalGastos.toLocaleString()}
      - Base mensual:      $${gastosOriginales.toLocaleString()}
      - Factor:            ${factorProrrateo.toFixed(2)}
    -------------------------------------
    UTILIDAD NETA:         $${utilidadNeta.toLocaleString()}
    MARGEN NETO:           ${margenNeto.toFixed(2)}%
    =====================================
    `);

    res.json({
      periodo: periodoTexto,
      fechaInicio: ventasPeriodo.rows[0].fecha_inicio,
      fechaFin: ventasPeriodo.rows[0].fecha_fin,
      ventasHoy: {
        pedidos: parseInt(ventasHoy.rows[0].total_pedidos),
        total: parseInt(ventasHoy.rows[0].ventas_total),
        ticketPromedio: parseInt(ventasHoy.rows[0].ticket_promedio)
      },
      ventasPeriodo: {
        pedidos: parseInt(ventasPeriodo.rows[0].total_pedidos),
        total: ventasPeriodoTotal,
        ticketPromedio: parseInt(ventasPeriodo.rows[0].ticket_promedio)
      },
      gastos: {
        fijos: Math.round(totalGastosFijos * factorProrrateo),
        variables: Math.round(totalGastosVariables * factorProrrateo),
        total: totalGastos,
        factorProrrateo: factorProrrateo,
        gastosMensuales: gastosOriginales
      },
      margenes: {
        utilidadBruta: utilidadBruta,
        utilidadNeta: utilidadNeta,
        margenBruto: parseFloat(margenBrutoReal.toFixed(2)),
        margenNeto: parseFloat(margenNeto.toFixed(2)),
        margenPromedio: parseFloat(margenPromedioReal.toFixed(2))
      },
      alertas: productosAlerta.rows,
      analisis: {
        productosConCosto: productosConCosto,
        costoCalculado: costoFinal,
        metodoCalculo: productosConCosto > 0 ? 'Basado en productos con costo real' : 'Estimación estándar',
        unidadesVendidas: parseInt(datosVentas?.unidades_vendidas || 0),
        productosDiferentes: parseInt(datosVentas?.productos_diferentes || 0)
      }
    });

  } catch (error) {
    console.error('❌ Error dashboard rentabilidad:', error);
    res.status(500).json({ error: 'Error obteniendo dashboard de rentabilidad' });
  }
});

// 💵 Actualizar costo de un producto
app.put('/api/admin/productos/:id/costo', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { costo_compra, margen_objetivo } = req.body;
    
    console.log(`💰 Actualizando costo producto ${id}: $${costo_compra}, margen objetivo: ${margen_objetivo}%`);
    
    // Validar datos
    if (costo_compra < 0) {
      return res.status(400).json({ error: 'El costo no puede ser negativo' });
    }

    // Calcular precio sugerido basado en margen objetivo
    let precioSugerido = null;
    let categoriaMargen = null;
    
    if (costo_compra > 0 && margen_objetivo > 0) {
      precioSugerido = Math.round(costo_compra / (1 - margen_objetivo / 100));
      
      // Determinar categoría
      if (margen_objetivo >= 35) categoriaMargen = 'alto';
      else if (margen_objetivo >= 20) categoriaMargen = 'medio';
      else categoriaMargen = 'bajo';
    }

    // Actualizar producto
    const result = await pool.query(`
      UPDATE productos 
      SET 
        costo_compra = $1,
        margen_objetivo = $2,
        categoria_margen = $3
      WHERE id = $4
      RETURNING *,
        CASE 
          WHEN $1 > 0 AND precio > 0 
          THEN ROUND(((precio - $1)::DECIMAL / precio) * 100, 2)
          ELSE NULL
        END as margen_actual
    `, [
      costo_compra || null,
      margen_objetivo || null,
      categoriaMargen,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const producto = result.rows[0];
    console.log(`✅ Costo actualizado - Margen actual: ${producto.margen_actual}%`);

    res.json({
      success: true,
      producto: producto,
      precioSugerido: precioSugerido,
      analisis: {
        margenActual: producto.margen_actual,
        estado: producto.margen_actual < 15 ? 'margen_bajo' : 
                producto.margen_actual < 0 ? 'perdida' : 'ok'
      }
    });

  } catch (error) {
    console.error('❌ Error actualizando costo:', error);
    res.status(500).json({ error: 'Error actualizando costo del producto' });
  }
});

// 📊 Obtener todos los productos con análisis de márgenes
app.get('/api/admin/productos/margenes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📊 Obteniendo análisis de márgenes...');
    
    const result = await pool.query(`
      SELECT 
        id,
        nombre,
        categoria,
        precio,
        costo_compra,
        stock,
        codigo,
        CASE 
          WHEN costo_compra IS NOT NULL AND costo_compra > 0 AND precio > 0
          THEN ROUND(((precio - costo_compra)::DECIMAL / precio) * 100, 2)
          ELSE NULL
        END as margen_actual,
        margen_objetivo,
        categoria_margen,
        CASE
          WHEN costo_compra IS NULL THEN 'sin_costo'
          WHEN costo_compra = 0 THEN 'sin_costo'
          WHEN precio <= costo_compra THEN 'perdida'
          WHEN ((precio - costo_compra)::DECIMAL / precio) < 0.15 THEN 'margen_bajo'
          WHEN ((precio - costo_compra)::DECIMAL / precio) >= 0.35 THEN 'margen_alto'
          ELSE 'margen_normal'
        END as estado_margen,
        CASE 
          WHEN costo_compra IS NOT NULL AND costo_compra > 0
          THEN precio - costo_compra
          ELSE NULL
        END as utilidad_unitaria
      FROM productos
      ORDER BY 
        CASE 
          WHEN costo_compra IS NULL OR costo_compra = 0 THEN 0
          WHEN precio <= costo_compra THEN 1
          WHEN ((precio - costo_compra)::DECIMAL / precio) < 0.15 THEN 2
          ELSE 3
        END,
        nombre
    `);

    // Estadísticas generales
    const stats = {
      total: result.rows.length,
      sinCosto: result.rows.filter(p => p.estado_margen === 'sin_costo').length,
      perdida: result.rows.filter(p => p.estado_margen === 'perdida').length,
      margenBajo: result.rows.filter(p => p.estado_margen === 'margen_bajo').length,
      margenNormal: result.rows.filter(p => p.estado_margen === 'margen_normal').length,
      margenAlto: result.rows.filter(p => p.estado_margen === 'margen_alto').length
    };

    console.log(`✅ Análisis completado: ${stats.total} productos, ${stats.perdida} en pérdida`);

    res.json({
      productos: result.rows,
      estadisticas: stats
    });

  } catch (error) {
    console.error('❌ Error obteniendo márgenes:', error);
    res.status(500).json({ error: 'Error obteniendo análisis de márgenes' });
  }
});

// 💰 Gestión de gastos operativos
app.get('/api/admin/gastos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM gastos_operativos 
      WHERE activo = TRUE 
      ORDER BY tipo, concepto
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error obteniendo gastos:', error);
    res.status(500).json({ error: 'Error obteniendo gastos operativos' });
  }
});

// Agregar nuevo gasto
app.post('/api/admin/gastos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { concepto, monto, tipo, frecuencia, porcentaje, notas } = req.body;
    
    if (!concepto || !tipo) {
      return res.status(400).json({ error: 'Concepto y tipo son requeridos' });
    }

    const result = await pool.query(`
      INSERT INTO gastos_operativos (concepto, monto, tipo, frecuencia, porcentaje, notas)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [concepto, monto || 0, tipo, frecuencia || 'mensual', porcentaje, notas]);

    console.log(`✅ Gasto agregado: ${concepto}`);
    res.json({ success: true, gasto: result.rows[0] });

  } catch (error) {
    console.error('❌ Error agregando gasto:', error);
    res.status(500).json({ error: 'Error agregando gasto operativo' });
  }
});

// Actualizar gasto
app.put('/api/admin/gastos/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { concepto, monto, tipo, frecuencia, porcentaje, notas, activo } = req.body;

    const result = await pool.query(`
      UPDATE gastos_operativos 
      SET concepto = $1, monto = $2, tipo = $3, frecuencia = $4, 
          porcentaje = $5, notas = $6, activo = $7
      WHERE id = $8
      RETURNING *
    `, [concepto, monto, tipo, frecuencia, porcentaje, notas, activo, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }

    console.log(`✅ Gasto actualizado: ${concepto}`);
    res.json({ success: true, gasto: result.rows[0] });

  } catch (error) {
    console.error('❌ Error actualizando gasto:', error);
    res.status(500).json({ error: 'Error actualizando gasto operativo' });
  }
});

// Eliminar gasto operativo
app.delete('/api/admin/gastos/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM gastos_operativos WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }

    console.log(`✅ Gasto eliminado: ${result.rows[0].concepto}`);
    res.json({ success: true, message: 'Gasto eliminado exitosamente' });

  } catch (error) {
    console.error('❌ Error eliminando gasto:', error);
    res.status(500).json({ error: 'Error eliminando gasto operativo' });
  }
});

// ✅ FIN DEL SISTEMA DE MÁRGENES

// ===================
// 🏆 SISTEMA DE PUNTOS Y FIDELIZACIÓN - SUPERCASA
// ===================

// 📊 Obtener mi saldo de puntos
app.get('/api/puntos/mi-saldo', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pp.puntos_disponibles,
        pp.puntos_totales,
        pp.puntos_canjeados,
        pp.nivel,
        np.multiplicador_puntos,
        np.color_hex,
        np.icono,
        np.beneficios,
        (SELECT puntos_minimos FROM niveles_programa WHERE orden = np.orden + 1) as puntos_siguiente_nivel
      FROM programa_puntos pp
      JOIN niveles_programa np ON pp.nivel = np.nombre
      WHERE pp.usuario_id = $1
    `, [req.user.userId]);
    
    if (result.rows.length === 0) {
      // Crear perfil si no existe
      await pool.query(
        'INSERT INTO programa_puntos (usuario_id) VALUES ($1)',
        [req.user.userId]
      );
      
      return res.json({
        puntos_disponibles: 0,
        puntos_totales: 0,
        puntos_canjeados: 0,
        nivel: 'BRONCE',
        multiplicador: 1.0,
        color_hex: '#CD7F32',
        icono: '🥉'
      });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('❌ Error obteniendo saldo de puntos:', error);
    res.status(500).json({ error: 'Error obteniendo saldo de puntos' });
  }
});

// 🎯 ENDPOINT: Canjear puntos por descuento (VERSIÓN CORREGIDA)
app.post('/api/puntos/canjear', authenticateToken, async (req, res) => {
  const { puntos_a_canjear } = req.body;
  const usuarioId = req.user.userId;

  try {
    
    // Validar mínimo 50 puntos
    if (puntos_a_canjear < 50) {
      return res.status(400).json({
        success: false,
        message: 'Mínimo 50 puntos para canjear'
      });
    }

    // Validar múltiplos de 10
    if (puntos_a_canjear % 10 !== 0) {
      return res.status(400).json({
        success: false,
        message: 'Solo puedes canjear múltiplos de 10 puntos'
      });
    }

    // Obtener saldo actual
    const saldoResult = await pool.query(
      'SELECT puntos_disponibles FROM programa_puntos WHERE usuario_id = $1',
      [usuarioId]
    );

    if (!saldoResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'No tienes un programa de puntos activo'
      });
    }

    const puntosDisponibles = saldoResult.rows[0].puntos_disponibles;

    // Validar saldo suficiente
    if (puntosDisponibles < puntos_a_canjear) {
      return res.status(400).json({
        success: false,
        message: `Solo tienes ${puntosDisponibles} puntos disponibles`
      });
    }

    // ✅ CORRECCIÓN: Calcular valor del descuento (1 punto = $100)
    const valorDescuento = puntos_a_canjear * 10; // ✅ NUEVO: 1 punto = $10

    // Generar código único
    const codigoCanje = `PTS${Date.now().toString(36).toUpperCase()}`;

    // Crear el canje con estado ACTIVO
    const canjeResult = await pool.query(`
      INSERT INTO canjes_recompensas 
      (usuario_id, puntos_usados, codigo_canje, estado, valor_descuento, fecha_expiracion)
      VALUES ($1, $2, $3, 'ACTIVO', $4, CURRENT_DATE + INTERVAL '30 days')
      RETURNING *
    `, [usuarioId, puntos_a_canjear, codigoCanje, valorDescuento]);

    // NO ACTUALIZAR PUNTOS AQUÍ - Solo devolver los puntos que QUEDARÍAN
    const puntosRestantes = puntosDisponibles - puntos_a_canjear;

    console.log(`🎯 Canje ACTIVO creado: ${puntos_a_canjear} puntos = $${valorDescuento} descuento`);

    res.json({
      success: true,
      canje: {
        codigo: codigoCanje,
        puntos_canjeados: puntos_a_canjear,
        valor_descuento: valorDescuento,
        fecha_expiracion: canjeResult.rows[0].fecha_expiracion,
        puntos_restantes: puntosRestantes,
        estado: 'ACTIVO'
      },
      message: `Canje exitoso: ${puntos_a_canjear} puntos = $${valorDescuento.toLocaleString('es-CO')} de descuento`
    });

  } catch (error) {
    console.error('❌ Error en canje:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar el canje'
    });
  }
});

// 🆕 NUEVO ENDPOINT: Cancelar canje activo
app.post('/api/puntos/cancelar-canje', authenticateToken, async (req, res) => {
  const { codigo_canje } = req.body;
  const usuarioId = req.user.userId;

  try {
    // Buscar y cancelar canje activo
    const canjeResult = await pool.query(`
      UPDATE canjes_recompensas 
      SET estado = 'EXPIRADO' 
      WHERE codigo_canje = $1 
      AND usuario_id = $2 
      AND estado = 'ACTIVO'
      RETURNING *
    `, [codigo_canje, usuarioId]);

    if (canjeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Canje no encontrado o ya fue usado'
      });
    }

    console.log(`🔄 Canje ${codigo_canje} cancelado (marcado como EXPIRADO)`);

    res.json({
      success: true,
      message: 'Canje cancelado exitosamente'
    });

  } catch (error) {
    console.error('❌ Error cancelando canje:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cancelar el canje'
    });
  }
});

// 🆕 NUEVO ENDPOINT: Cancelar canje pendiente
app.post('/api/puntos/cancelar-canje', authenticateToken, async (req, res) => {
  const { codigo_canje } = req.body;
  const usuarioId = req.user.userId;

  try {
    // Buscar canje pendiente
    const canjeResult = await pool.query(`
      UPDATE canjes_recompensas 
      SET estado = 'CANCELADO' 
      WHERE codigo_canje = $1 
      AND usuario_id = $2 
      AND estado = 'PENDIENTE'
      RETURNING *
    `, [codigo_canje, usuarioId]);

    if (canjeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Canje no encontrado o ya fue usado'
      });
    }

    console.log(`🔄 Canje ${codigo_canje} cancelado`);

    res.json({
      success: true,
      message: 'Canje cancelado exitosamente'
    });

  } catch (error) {
    console.error('❌ Error cancelando canje:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cancelar el canje'
    });
  }
});
// 🎯 ENDPOINT: Obtener canjes activos del usuario
app.get('/api/puntos/mis-canjes', authenticateToken, async (req, res) => {
  try {
    const canjes = await pool.query(`
      SELECT codigo_canje, puntos_usados, valor_descuento, estado, fecha_expiracion
      FROM canjes_recompensas
      WHERE usuario_id = $1 AND estado = 'ACTIVO'
      ORDER BY fecha_canje DESC
    `, [req.user.userId]);

    res.json({
      success: true,
      canjes: canjes.rows
    });
  } catch (error) {
    console.error('❌ Error obteniendo canjes:', error);
    res.status(500).json({ success: false });
  }
});

// 📜 Obtener historial de puntos
app.get('/api/puntos/historial', authenticateToken, async (req, res) => {
  try {
    const { limite = 20, offset = 0 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        tp.*,
        p.id as numero_pedido
      FROM transacciones_puntos tp
      LEFT JOIN pedidos p ON tp.pedido_id = p.id
      WHERE tp.usuario_id = $1
      ORDER BY tp.fecha DESC
      LIMIT $2 OFFSET $3
    `, [req.user.userId, limite, offset]);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error obteniendo historial' });
  }
});

// 🎁 Obtener catálogo de recompensas
app.get('/api/puntos/recompensas', authenticateToken, async (req, res) => {
  try {
    const { categoria } = req.query;
    
    // Obtener nivel del usuario
    const nivelResult = await pool.query(
      'SELECT nivel FROM programa_puntos WHERE usuario_id = $1',
      [req.user.userId]
    );
    
    const nivelUsuario = nivelResult.rows[0]?.nivel || 'BRONCE';
    
    // Obtener orden del nivel
    const ordenResult = await pool.query(
      'SELECT orden FROM niveles_programa WHERE nombre = $1',
      [nivelUsuario]
    );
    
    const ordenNivel = ordenResult.rows[0]?.orden || 1;
    
    let query = `
      SELECT 
        r.*,
        np.orden as nivel_orden_requerido,
        CASE 
          WHEN np.orden <= $1 THEN true 
          ELSE false 
        END as disponible_para_usuario
      FROM recompensas r
      LEFT JOIN niveles_programa np ON r.nivel_minimo = np.nombre
      WHERE r.activo = true
      AND (r.fecha_fin IS NULL OR r.fecha_fin > NOW())
      AND (r.stock IS NULL OR r.stock_usado < r.stock)
    `;
    
    const params = [ordenNivel];
    
    if (categoria && categoria !== 'todos') {
      query += ' AND r.categoria = $2';
      params.push(categoria);
    }
    
    query += ' ORDER BY r.puntos_requeridos ASC';
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error obteniendo recompensas:', error);
    res.status(500).json({ error: 'Error obteniendo recompensas' });
  }
});

// 🎁 Canjear recompensa
app.post('/api/puntos/canjear/:recompensaId', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { recompensaId } = req.params;
    
    await client.query('BEGIN');
    
    // Verificar recompensa
    const recompensaResult = await client.query(
      'SELECT * FROM recompensas WHERE id = $1 AND activo = true FOR UPDATE',
      [recompensaId]
    );
    
    if (recompensaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Recompensa no encontrada' });
    }
    
    const recompensa = recompensaResult.rows[0];
    
    // Verificar stock
    if (recompensa.stock !== null && recompensa.stock_usado >= recompensa.stock) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Recompensa agotada' });
    }
    
    // Verificar puntos del usuario
    const puntosResult = await client.query(
      'SELECT puntos_disponibles, nivel FROM programa_puntos WHERE usuario_id = $1 FOR UPDATE',
      [req.user.userId]
    );
    
    if (puntosResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Usuario sin programa de puntos' });
    }
    
    const { puntos_disponibles, nivel } = puntosResult.rows[0];
    
    if (puntos_disponibles < recompensa.puntos_requeridos) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Puntos insuficientes',
        puntos_disponibles,
        puntos_requeridos: recompensa.puntos_requeridos
      });
    }
    
    // Verificar nivel mínimo
    const nivelOrdenResult = await client.query(`
      SELECT 
        (SELECT orden FROM niveles_programa WHERE nombre = $1) as nivel_usuario,
        (SELECT orden FROM niveles_programa WHERE nombre = $2) as nivel_requerido
    `, [nivel, recompensa.nivel_minimo]);
    
    const { nivel_usuario, nivel_requerido } = nivelOrdenResult.rows[0];
    
    if (nivel_usuario < nivel_requerido) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Esta recompensa requiere nivel ${recompensa.nivel_minimo}` 
      });
    }
    
    // Generar código único
    const codigoCanje = `CJ${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + (recompensa.validez_dias || 30));
    
    // Crear canje
    const canjeResult = await client.query(`
      INSERT INTO canjes_recompensas 
      (usuario_id, recompensa_id, puntos_usados, codigo_canje, fecha_expiracion)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      req.user.userId,
      recompensaId,
      recompensa.puntos_requeridos,
      codigoCanje,
      fechaExpiracion
    ]);
    
   
    
    // Registrar transacción
    await client.query(`
      INSERT INTO transacciones_puntos 
      (usuario_id, tipo, puntos, descripcion, saldo_anterior, saldo_nuevo)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      req.user.userId,
      'CANJEADO',
      -recompensa.puntos_requeridos,
      `Canje: ${recompensa.nombre}`,
      puntos_disponibles,
      puntos_disponibles - recompensa.puntos_requeridos
    ]);
    
    // Actualizar stock de recompensa
    if (recompensa.stock !== null) {
      await client.query(
        'UPDATE recompensas SET stock_usado = stock_usado + 1 WHERE id = $1',
        [recompensaId]
      );
      
    }
    await client.query(`
      UPDATE programa_puntos
      SET puntos_disponibles = puntos_disponibles - $1,
          puntos_canjeados = puntos_canjeados + $1,
          ultima_actualizacion = CURRENT_TIMESTAMP
      WHERE usuario_id = $2
    `, [recompensa.puntos_requeridos, req.user.userId]);
    
    console.log(`✅ Descontados ${recompensa.puntos_requeridos} puntos del usuario ${req.user.userId}`);
    
    await client.query('COMMIT');
    
    
    console.log(`🎁 Recompensa canjeada: ${recompensa.nombre} por usuario ${req.user.userId}`);
    
    res.json({
      success: true,
      canje: {
        id: canjeResult.rows[0].id,
        codigo: codigoCanje,
        recompensa: recompensa.nombre,
        tipo: recompensa.tipo,
        valor: recompensa.valor,
        expira: fechaExpiracion,
        puntos_usados: recompensa.puntos_requeridos
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error canjeando recompensa:', error);
    res.status(500).json({ error: 'Error canjeando recompensa' });
  } finally {
    client.release();
  }
});

// 🎯 ENDPOINT: Obtener opciones de canje disponibles
app.get('/api/puntos/opciones-canje', authenticateToken, async (req, res) => {
  try {
    // Obtener saldo actual del usuario
    const saldoResult = await pool.query(
      'SELECT puntos_disponibles FROM programa_puntos WHERE usuario_id = $1',
      [req.user.userId]
    );
    
    const puntosDisponibles = saldoResult.rows[0]?.puntos_disponibles || 0;
    
   const opcionesCanje = [
  { 
    puntos: 50, 
    valor: 500,     // 🔧 CAMBIAR DE 5000 A 500
    descripcion: '$500 de descuento',  // 🔧 ACTUALIZAR DESCRIPCIÓN
    disponible: puntosDisponibles >= 50
  },
  { 
    puntos: 100, 
    valor: 1000,    // 🔧 CAMBIAR DE 10000 A 1000
    descripcion: '$1,000 de descuento',  // 🔧 ACTUALIZAR DESCRIPCIÓN
    disponible: puntosDisponibles >= 100
  },
  { 
    puntos: 200, 
    valor: 2200,    // 🔧 CAMBIAR DE 22000 A 2200
    descripcion: '$2,200 de descuento (10% extra)',  // 🔧 ACTUALIZAR DESCRIPCIÓN
    disponible: puntosDisponibles >= 200
  },
  { 
    puntos: 500, 
    valor: 6000,    // 🔧 CAMBIAR DE 60000 A 6000
    descripcion: '$6,000 de descuento (20% extra)',  // 🔧 ACTUALIZAR DESCRIPCIÓN
    disponible: puntosDisponibles >= 500
  }
];
    
    res.json({
      success: true,
      puntos_disponibles: puntosDisponibles,
      opciones: opcionesCanje
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo opciones de canje:', error);
    res.status(500).json({ error: 'Error obteniendo opciones de canje' });
  }
});

// 🎫 Obtener mis canjes
app.get('/api/puntos/mis-canjes', authenticateToken, async (req, res) => {
  try {
    const { estado = 'todos' } = req.query;
    
    let query = `
      SELECT 
        cr.*,
        r.nombre as recompensa_nombre,
        r.descripcion as recompensa_descripcion,
        r.tipo as recompensa_tipo,
        r.valor as recompensa_valor
      FROM canjes_recompensas cr
      JOIN recompensas r ON cr.recompensa_id = r.id
      WHERE cr.usuario_id = $1
    `;
    
    const params = [req.user.userId];
    
    if (estado !== 'todos') {
      query += ' AND cr.estado = $2';
      params.push(estado.toUpperCase());
    }
    
    query += ' ORDER BY cr.fecha_canje DESC';
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error obteniendo canjes:', error);
    res.status(500).json({ error: 'Error obteniendo canjes' });
  }
});

// ✅ Validar código de canje
app.post('/api/puntos/validar-canje', authenticateToken, async (req, res) => {
  try {
    const { codigo } = req.body;
    
    if (!codigo) {
      return res.status(400).json({ error: 'Código requerido' });
    }
    
    const result = await pool.query(`
      SELECT 
        cr.*,
        r.nombre as recompensa_nombre,
        r.tipo as recompensa_tipo,
        r.valor as recompensa_valor
      FROM canjes_recompensas cr
      JOIN recompensas r ON cr.recompensa_id = r.id
      WHERE cr.codigo_canje = $1 
      AND cr.usuario_id = $2
    `, [codigo, req.user.userId]);
    
    if (result.rows.length === 0) {
      return res.json({ 
        valido: false, 
        error: 'Código no válido o no pertenece a tu cuenta' 
      });
    }
    
    const canje = result.rows[0];
    
    // Verificar estado
    if (canje.estado === 'USADO') {
      return res.json({ 
        valido: false, 
        error: 'Este código ya fue utilizado' 
      });
    }
    
    if (canje.estado === 'EXPIRADO' || new Date(canje.fecha_expiracion) < new Date()) {
      return res.json({ 
        valido: false, 
        error: 'Este código ha expirado' 
      });
    }
    
    res.json({
      valido: true,
      canje: {
        codigo: canje.codigo_canje,
        recompensa: canje.recompensa_nombre,
        tipo: canje.recompensa_tipo,
        valor: canje.recompensa_valor,
        expira: canje.fecha_expiracion
      }
    });
    
  } catch (error) {
    console.error('❌ Error validando canje:', error);
    res.status(500).json({ error: 'Error validando código' });
  }
});

// 🏆 ENDPOINTS ADMIN - Sistema de Puntos

// Dashboard de puntos
app.get('/api/admin/puntos/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      // Usuarios en programa
      pool.query('SELECT COUNT(*) as total FROM programa_puntos'),
      pool.query('SELECT COUNT(*) as activos FROM programa_puntos WHERE puntos_totales > 0'),
      
      // Puntos totales
      pool.query('SELECT SUM(puntos_totales) as emitidos, SUM(puntos_canjeados) as canjeados FROM programa_puntos'),
      
      // Distribución por niveles
      pool.query('SELECT nivel, COUNT(*) as cantidad FROM programa_puntos GROUP BY nivel'),
      
      // Recompensas
      pool.query('SELECT COUNT(*) as total_canjes FROM canjes_recompensas'),
      pool.query('SELECT COUNT(*) as canjes_mes FROM canjes_recompensas WHERE fecha_canje >= DATE_TRUNC(\'month\', CURRENT_DATE)'),
      
      // Top usuarios
      pool.query(`
        SELECT 
          u.nombre,
          pp.puntos_totales,
          pp.nivel
        FROM programa_puntos pp
        JOIN usuarios u ON pp.usuario_id = u.id
        ORDER BY pp.puntos_totales DESC
        LIMIT 10
      `)
    ]);
    
    res.json({
      usuarios: {
        total: parseInt(stats[0].rows[0].total),
        activos: parseInt(stats[1].rows[0].activos)
      },
      puntos: {
        emitidos: parseInt(stats[2].rows[0].emitidos || 0),
        canjeados: parseInt(stats[2].rows[0].canjeados || 0),
        disponibles: parseInt(stats[2].rows[0].emitidos || 0) - parseInt(stats[2].rows[0].canjeados || 0)
      },
      niveles: stats[3].rows,
      canjes: {
        total: parseInt(stats[4].rows[0].total_canjes),
        este_mes: parseInt(stats[5].rows[0].canjes_mes)
      },
      top_usuarios: stats[6].rows
    });
    
  } catch (error) {
    console.error('❌ Error dashboard puntos:', error);
    res.status(500).json({ error: 'Error obteniendo dashboard' });
  }
});

// Otorgar puntos manual
app.post('/api/admin/puntos/otorgar', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { usuario_id, puntos, descripcion } = req.body;
    
    if (!usuario_id || !puntos) {
      return res.status(400).json({ error: 'Usuario y puntos requeridos' });
    }
    
    const resultado = await asignarPuntosUsuario(
      usuario_id,
      null,
      puntos,
      descripcion || 'Puntos otorgados por administrador'
    );
    
    if (resultado) {
      console.log(`✅ Admin otorgó ${puntos} puntos a usuario ${usuario_id}`);
      res.json({ 
        success: true, 
        message: `${puntos} puntos otorgados exitosamente` 
      });
    } else {
      res.status(400).json({ error: 'Error otorgando puntos' });
    }
    
  } catch (error) {
    console.error('❌ Error otorgando puntos:', error);
    res.status(500).json({ error: 'Error otorgando puntos' });
  }
});

// ✅ FIN DEL SISTEMA DE PUNTOS

// ===================
// 🛍️ RUTAS DE PEDIDOS
// ===================



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

// 📦 Obtener todos los pedidos para gestión admin CON DESGLOSE DE ENVÍO
app.get('/api/admin/pedidos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { torre, estado } = req.query;

    let query = `
      SELECT
        p.*,
        u.nombre as usuario_nombre,
        u.email as usuario_email,
        u.telefono as usuario_telefono,
        CONCAT('Torre ', p.torre_entrega, ', Piso ', p.piso_entrega, ', Apt ', p.apartamento_entrega) as direccion_completa,
        -- Información de descuentos
        p.descuento_monto,
        p.descuento_porcentaje,
        p.codigo_promocional,
        p.codigo_canje,
        p.costo_envio,
        p.subtotal,
        -- Si hay canje, obtener el valor del descuento
        cr.valor_descuento as descuento_canje
      FROM pedidos p
      LEFT JOIN usuarios u ON p.usuario_id = u.id
      LEFT JOIN canjes_recompensas cr ON cr.codigo_canje = p.codigo_canje
    `;

    const params = [];

    if (torre && ['1', '2', '3', '4', '5'].includes(torre)) {
      query += ` WHERE p.torre_entrega = $${params.length + 1}`;
      params.push(torre);
    }

    if (estado && estado !== 'todos') {
      const whereClause = params.length > 0 ? ' AND' : ' WHERE';
      query += `${whereClause} p.estado = $${params.length + 1}`;
      params.push(estado);
    }

    query += ' ORDER BY p.fecha DESC';

    const result = await pool.query(query, params);

// ✅ MAPEAR PEDIDOS TAL COMO VIENEN - SIN CALCULAR NADA
const pedidosConDesglose = result.rows.map(pedido => {
  const metodoPago = pedido.payment_reference ? 'digital' : 'efectivo';
  
  // Solo parsear productos, sin calcular
  let productos = [];
  try {
    productos = typeof pedido.productos === 'string' 
      ? JSON.parse(pedido.productos) 
      : pedido.productos || [];
  } catch (error) {
    console.error('Error parsing productos:', error);
    productos = [];
  }
  
  return {
    ...pedido,
    productos: productos,
    total: parseFloat(pedido.total), // TOTAL TAL COMO VIENE DEL CARRITO
    metodo_pago: metodoPago,
    codigo_promocional: null, // Se llenará abajo si existe
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
    payment_amount_cents: pedido.payment_amount_cents,
    usuario: {
      nombre: pedido.usuario_nombre,
      email: pedido.usuario_email,
      telefono: pedido.usuario_telefono
    }
  };
});



res.json(pedidosConDesglose);
  } catch (err) {
    console.error('❌ Error obteniendo pedidos admin:', err);
    res.status(500).json({ error: 'Error obteniendo pedidos' });
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
            let datosEntrega = {};
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

              datosEntrega = typeof carritoTemp.rows[0].datos_entrega === 'string' 
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
    payment_method, payment_transaction_id, payment_amount_cents, estado,
    codigo_promocional, codigo_canje, subtotal, descuento_monto, costo_envio
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  RETURNING id`,
  [
  usuario.id,
  JSON.stringify(productosReales),
  transaction.amount_in_cents / 100,
  datosEntrega.torre_entrega || usuario.torre || '1',
  parseInt(datosEntrega.piso_entrega || usuario.piso) || 1,
  datosEntrega.apartamento_entrega || usuario.apartamento || '101',
  datosEntrega.telefono_contacto || usuario.telefono,
  reference,
  'APPROVED',
  paymentMethod,
  transactionId,
  transaction.amount_in_cents,
  'pendiente',
  null,                                   // $14 - codigo_promocional
  null,                                   // $15 - codigo_canje
  transaction.amount_in_cents / 100,      // $16 - subtotal
  0,                                       // $17 - descuento_monto
  0                                        // $18 - costo_envio
]
);

            // 🆕 LOG ESPECÍFICO PARA TARJETAS
            if (paymentMethod === 'CARD') {
              console.log(`💳 Pedido con TARJETA ${pedidoWebhook.rows[0].id} creado exitosamente`);
            } else {
              console.log(`✅ Pedido ${pedidoWebhook.rows[0].id} creado desde webhook con productos reales`);
            }
           // ✅ REEMPLAZAR EL CÓDIGO ANTERIOR CON ESTE CÓDIGO CORREGIDO

// ✅ ENVIAR WHATSAPP PARA PAGOS DIGITALES - VERSIÓN CORREGIDA
// ✅ REEMPLAZAR TODO EL CÓDIGO AGREGADO CON ESTO:
try {
  console.log('📱 Enviando confirmación WhatsApp para pago digital...');
  
  const pedidoCreado = pedidoWebhook.rows[0];
  
  // ✅ ENVIAR WHATSAPP PARA PAGOS DIGITALES - VERSIÓN CORREGIDA
try {
  console.log('📱 Enviando confirmación WhatsApp para pago digital...');
  
  const pedidoCreado = pedidoWebhook.rows[0];
  
  // 🔍 DEBUG LOGS PARA IDENTIFICAR DATOS DISPONIBLES
  console.log('🔍 DEBUG - datosEntrega.telefono_contacto:', datosEntrega.telefono_contacto);
  console.log('🔍 DEBUG - usuario.telefono:', usuario.telefono);
  console.log('🔍 DEBUG - pedidoCreado completo:', pedidoCreado);
  
  // ✅ USAR DATOS DIRECTOS COMO EN EFECTIVO (NO del pedidoCreado)
  const pedidoCompleto = {
    id: pedidoCreado.id,
    numeroPedido: `SUP-${pedidoCreado.id}`,
    telefono_contacto: datosEntrega.telefono_contacto || usuario.telefono || '3001399242', // ✅ DIRECTO
    cliente_email: transaction.customer_email, // ✅ DIRECTO DE TRANSACCIÓN
    total: transaction.amount_in_cents / 100, // ✅ DIRECTO DE TRANSACCIÓN
    torre_entrega: datosEntrega.torre_entrega || usuario.torre || '1', // ✅ DIRECTO
    piso_entrega: datosEntrega.piso_entrega || usuario.piso || 1, // ✅ DIRECTO
    apartamento_entrega: datosEntrega.apartamento_entrega || usuario.apartamento || '101', // ✅ DIRECTO
    productos: productosReales, // ✅ DIRECTO
    payment_method: paymentMethod,
    payment_status: 'APPROVED'
  };

  console.log('📱 Datos WhatsApp preparados para:', pedidoCompleto.telefono_contacto);
  
  const whatsappResult = await enviarConfirmacionWhatsApp(pedidoCompleto);
  console.log('📱 WhatsApp para pago digital enviado:', whatsappResult);
  
} catch (whatsappError) {
  console.error('❌ Error WhatsApp en webhook (no crítico):', whatsappError);
}

  console.log('📱 Datos WhatsApp preparados para:', pedidoCreado.telefono_contacto);
  
  const whatsappResult = await enviarConfirmacionWhatsApp(pedidoCompleto);
  console.log('📱 WhatsApp para pago digital enviado:', whatsappResult);
  
} catch (whatsappError) {
  console.error('❌ Error WhatsApp en webhook (no crítico):', whatsappError);
}

// ✅ FIN DEL CÓDIGO A AGREGAR

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
      redirect_url: 'https://tiendasupercasa.com/',
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
      redirect_url: 'https://tiendasupercasa.com/',
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

// ===================================
// 🚚 FUNCIÓN CALCULAR COSTO DE ENVÍO (ACTUALIZADA)
// ===================================
function calcularCostoEnvio(subtotal, metodoPago) {
  console.log(`🚚 Calculando envío: $${subtotal} - Método: ${metodoPago}`);
  
  // Validar monto mínimo absoluto
  if (subtotal < 5000) {
    return { 
      error: 'Monto mínimo de compra: $5,000',
      codigo: 'MONTO_MINIMO'
    };
  }
  
  // PAGO DIGITAL: Mínimo $20,000 para envío gratis
  if (metodoPago === 'digital') {
    if (subtotal < 20000) {
      return { 
        error: 'Monto mínimo para pago digital: $20,000',
        codigo: 'MONTO_MINIMO_DIGITAL',
        faltante: 20000 - subtotal
      };
    } else {
      console.log('✅ Envío gratis - Digital >= $20,000');
      return { 
        costoEnvio: 0, 
        mensaje: '🎉 Envío gratis - Pago digital',
        envioGratis: true 
      };
    }
  }
  
  // PAGO EFECTIVO: Envío gratis >= $15,000, sino $2,000
  if (metodoPago === 'efectivo') {
    if (subtotal >= 15000) {
      console.log('✅ Envío gratis - Efectivo >= $15,000');
      return { 
        costoEnvio: 0, 
        mensaje: '🎉 Envío gratis - Pago efectivo',
        envioGratis: true 
      };
    } else {
      console.log('💰 Aplicando costo de envío: $2,000');
      return { 
        costoEnvio: 2000, 
        mensaje: '🚚 Costo de envío',
        envioGratis: false,
        faltanteEnvioGratis: 15000 - subtotal // Para mostrar cuánto falta
      };
    }
  }
  
  // Método no válido
  return { 
    error: 'Método de pago no válido',
    codigo: 'METODO_INVALIDO'
  };
}



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
    // ✅ AGREGAR ESTAS LÍNEAS DEBUG:
console.log('🔍 DEBUG CREAR-PAGO - datosEntrega extraído:', datosEntrega);
console.log('🔍 DEBUG CREAR-PAGO - datosEntrega tipo:', typeof datosEntrega);
console.log('🔍 DEBUG CREAR-PAGO - req.body.datosEntrega:', req.body.datosEntrega);
console.log('🔍 DEBUG CREAR-PAGO - telefono extraído:', telefono);


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
      redirect_url: 'https://tiendasupercasa.com/',
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
         // ✅ AGREGAR LAS 3 LÍNEAS DEBUG AQUÍ:
  console.log('🔍 DEBUG GUARDANDO - reference:', reference);
  console.log('🔍 DEBUG GUARDANDO - productos:', JSON.stringify(productos));
  console.log('🔍 DEBUG GUARDANDO - req.body.datosEntrega antes de guardar:', JSON.stringify(req.body.datosEntrega));
      await pool.query(
        `INSERT INTO carrito_temporal (referencia, usuario_id, productos, datos_entrega) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (referencia) DO UPDATE SET 
         productos = $3, datos_entrega = $4`,
        [
          reference,
          req.user.userId,
          JSON.stringify(productos),
          JSON.stringify(req.body.datosEntrega)
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

// 1. CORREGIR EL DOBLE DESCUENTO - Línea ~1650


// 2. AGREGAR ENDPOINT QUE FALTA - Agregar después de línea ~2700
app.get('/api/puntos/usuario', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pp.puntos_disponibles,
        pp.puntos_totales,
        pp.puntos_canjeados,
        pp.nivel,
        np.multiplicador_puntos,
        np.color_hex,
        np.icono
      FROM programa_puntos pp
      LEFT JOIN niveles_programa np ON pp.nivel = np.nombre
      WHERE pp.usuario_id = $1
    `, [req.user.userId]);
    
    if (result.rows.length === 0) {
      // Crear perfil si no existe
      await pool.query(
        'INSERT INTO programa_puntos (usuario_id) VALUES ($1)',
        [req.user.userId]
      );
      
      return res.json({
        puntos_disponibles: 0,
        puntos_totales: 0,
        nivel: 'BRONCE',
        multiplicador: 1.0
      });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo puntos:', error);
    res.status(500).json({ error: 'Error obteniendo puntos' });
  }
});

// 3. CORREGIR VALOR DE PUNTOS EN CANJE - Línea ~2826

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
      redirect_url: 'https://tiendasupercasa.com/',
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
    // Agregar campo codigo_canje a tabla pedidos
pool.query(`
  ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS codigo_canje VARCHAR(50)
`).then(() => console.log("✅ Campo codigo_canje agregado a pedidos"))
  .catch(err => console.log("ℹ️ Campo codigo_canje ya existe:", err.message));
  // Agregar campo codigo_promocional a pedidos
pool.query(`
  ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS codigo_promocional VARCHAR(50)
`).then(() => console.log("✅ Campo codigo_promocional agregado a pedidos"))
  .catch(err => console.log("ℹ️ Campo codigo_promocional ya existe:", err.message));
  }
});

// ===================================
// 📱 TWILIO WHATSAPP PARA SUPERCASA
// Agregar AL FINAL de index.js (antes de app.listen)
// ===================================



// Test endpoint
app.get('/test-whatsapp-prod', async (req, res) => {
  try {
    console.log('🧪 Probando WhatsApp en producción...');
    
    const message = await twilioClient.messages.create({
      body: '🏗️ SuperCasa - Sistema WhatsApp funcionando en producción!',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: 'whatsapp:+573001399242'
    });

    console.log(`✅ WhatsApp enviado: ${message.sid}`);
    res.json({ success: true, messageSid: message.sid });
    
  } catch (error) {
    console.error('❌ Error WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint
app.get('/debug-twilio', (req, res) => {
  res.json({
    account_sid: process.env.TWILIO_ACCOUNT_SID ? 'CONFIGURADO' : 'FALTANTE',
    auth_token: process.env.TWILIO_AUTH_TOKEN ? 'CONFIGURADO' : 'FALTANTE',
    whatsapp_number: process.env.TWILIO_WHATSAPP_NUMBER
  });
});
// ===================================
// 📱 TWILIO WHATSAPP PARA SUPERCASA
// CÓDIGO CORREGIDO Y OPTIMIZADO
// ===================================

// Configurar cliente Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ✅ Agregar campos WhatsApp a tabla pedidos
pool.query(`
  ALTER TABLE pedidos 
  ADD COLUMN IF NOT EXISTS whatsapp_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS whatsapp_message_sid VARCHAR(100),
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS whatsapp_delivered_at TIMESTAMP
`).then(() => console.log("✅ Campos WhatsApp agregados a tabla pedidos"))
  .catch(err => console.log("ℹ️ Campos WhatsApp ya existen:", err.message));
  // Agregar campos de descuento a tabla pedidos
pool.query(`
  ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS subtotal INTEGER,
  ADD COLUMN IF NOT EXISTS descuento_monto INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_porcentaje DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_envio INTEGER DEFAULT 0
`).then(() => console.log("✅ Campos de descuento agregados a pedidos"))
  .catch(err => console.log("ℹ️ Campos de descuento ya existen:", err.message));

// ✅ Crear tabla logs WhatsApp
pool.query(`
  CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id SERIAL PRIMARY KEY,
    pedido_id INTEGER REFERENCES pedidos(id),
    telefono VARCHAR(20),
    mensaje TEXT,
    tipo VARCHAR(20), -- 'confirmacion', 'bot_response', 'incoming'
    status VARCHAR(20), -- 'sent', 'delivered', 'failed'
    message_sid VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => console.log("✅ Tabla 'whatsapp_logs' lista"))
  .catch(err => console.error("❌ Error creando tabla whatsapp_logs:", err));

// ===================================
// 🤖 FUNCIÓN ENVIAR CONFIRMACIÓN WHATSAPP CORREGIDA
// ===================================
async function enviarConfirmacionWhatsApp(pedidoData) {
  try {
    const { 
      id, 
      total, 
      telefono_contacto, 
      torre_entrega, 
      piso_entrega, 
      apartamento_entrega, 
      productos 
    } = pedidoData;

    const numeroPedido = `SUP-${String(id).padStart(3, '0')}`;
    const direccion = `Torre ${torre_entrega}, Piso ${piso_entrega}, Apt ${apartamento_entrega}`;
    
    // Calcular productos
    const productosArray = typeof productos === 'string' ? JSON.parse(productos) : productos;
    const cantidadItems = productosArray.reduce((sum, item) => sum + (item.cantidad || 1), 0);
    
    console.log(`📱 Enviando confirmación TEMPLATE ${numeroPedido} a ${telefono_contacto}`);

    if (typeof telefono_contacto !== 'string') {
  console.error('❌ Error: telefono_contacto no está definido o no es una cadena.', telefono_contacto);
  return { success: false, error: 'Número de teléfono no válido para WhatsApp.' };
}

const numeroLimpio = telefono_contacto.replace(/\D/g, '');
const numeroWhatsApp = `whatsapp:+57${numeroLimpio}`;

    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    // INTENTAR PRIMERO CON TEMPLATE (cuando esté aprobado)
    if (process.env.WHATSAPP_TEMPLATE_SID) {
      try {
        const message = await twilioClient.messages.create({
          contentSid: process.env.WHATSAPP_TEMPLATE_SID,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: numeroWhatsApp,
          contentVariables: JSON.stringify({
            1: numeroPedido,
            2: Number(total).toLocaleString('es-CO'),
            3: direccion,
            4: cantidadItems.toString()
          })
        });

        console.log(`✅ Confirmación TEMPLATE enviada: ${message.sid}`);
        await actualizarPedidoWhatsApp(id, message.sid, 'Template confirmación');
        return { success: true, messageSid: message.sid };

      } catch (templateError) {
        console.log('⚠️ Template falló, usando mensaje libre:', templateError.message);
      }
    }

    // BACKUP: Mensaje libre (solo funciona si hay sesión activa)
    const mensaje = `🎉 *¡Pedido Confirmado!*

📦 **Número:** ${numeroPedido}
💰 **Total:** $${Number(total).toLocaleString('es-CO')}
📍 **Entrega:** ${direccion}
🛒 **Items:** ${cantidadItems} productos

⚡ **Tiempo estimado:** Máximo 20 minutos

¡Gracias por elegir SuperCasa! 🏠

💬 _Escribe ${numeroPedido} para consultar estado_`;

    const message = await twilioClient.messages.create({
      body: mensaje,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: numeroWhatsApp
    });

    console.log(`✅ Confirmación LIBRE enviada: ${message.sid}`);
    await actualizarPedidoWhatsApp(id, message.sid, 'Confirmación libre');
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('❌ Error enviando confirmación WhatsApp:', error);
    await logErrorWhatsApp(pedidoData.id, pedidoData.telefono_contacto, error.message);
    return { success: false, error: error.message };
  }
}

// ===================================
// 🔧 FUNCIONES AUXILIARES WHATSAPP
// ===================================
async function actualizarPedidoWhatsApp(pedidoId, messageSid, tipo) {
  try {
    await pool.query(
      'UPDATE pedidos SET whatsapp_status = $1, whatsapp_message_sid = $2, whatsapp_sent_at = CURRENT_TIMESTAMP WHERE id = $3',
      ['sent', messageSid, pedidoId]
    );

    await pool.query(
      'INSERT INTO whatsapp_logs (pedido_id, telefono, mensaje, tipo, status, message_sid) VALUES ($1, $2, $3, $4, $5, $6)',
      [pedidoId, 'confirmacion', tipo, 'confirmacion', 'sent', messageSid]
    );
  } catch (error) {
    console.error('❌ Error actualizando pedido WhatsApp:', error);
  }
}

async function logErrorWhatsApp(pedidoId, telefono, errorMessage) {
  try {
    await pool.query(
      'INSERT INTO whatsapp_logs (pedido_id, telefono, mensaje, tipo, status) VALUES ($1, $2, $3, $4, $5)',
      [pedidoId, telefono, errorMessage, 'confirmacion', 'failed']
    );
  } catch (error) {
    console.error('❌ Error loggeando error WhatsApp:', error);
  }
}
// ===================================
// 📞 WEBHOOK WHATSAPP - RECIBIR MENSAJES
// ===================================
app.post('/webhook/whatsapp', express.urlencoded({ extended: false }), async (req, res) => {
  console.log('📥 Webhook WhatsApp PRODUCCIÓN recibido:', req.body);
  
  try {
    // ✅ RESPUESTA INMEDIATA CRÍTICA (ARREGLA ERROR 12200)
    res.status(200).send('');
    
    const { From, Body, MessageSid, SmsStatus } = req.body;
    
    if (!From || !Body) {
      console.log('⚠️ Webhook sin From o Body, ignorando');
      return;
    }
    
    // Extraer número limpio
    const telefono = From.replace('whatsapp:+57', '').replace('whatsapp:', '').replace('+57', '');
    const mensaje = Body.toLowerCase().trim();
    
    console.log(`📱 Mensaje PRODUCCIÓN de ${telefono}: "${Body}"`);
    
    // Procesar mensaje asíncronamente (evita timeouts)
    procesarMensajeWhatsAppProduccion(telefono, Body, From);
    
  } catch (error) {
    console.error('❌ Error en webhook PRODUCCIÓN:', error);
    // NO cambiar response - ya enviamos 200 OK
  }
});

// ===================================
// 🤖 PROCESADOR DE MENSAJES CORREGIDO
// ===================================
async function procesarMensajeWhatsAppProduccion(telefono, mensajeOriginal, fromWhatsApp) {
  try {
    const mensaje = mensajeOriginal.toLowerCase().trim();
    let respuesta = null;

    // 1. CONSULTA DE PEDIDO ESPECÍFICO
    if (mensaje.includes('sup-') || /pedido\s*\d+/.test(mensaje)) {
      const match = mensaje.match(/sup-?(\d+)/i) || mensaje.match(/pedido\s*(\d+)/i);
      if (match) {
        const pedidoNumero = match[1];
        respuesta = await consultarPedidoWhatsApp(pedidoNumero, telefono);
      }
    }
    // 2. PRODUCTOS/CATÁLOGO
    else if (mensaje.includes('producto') || mensaje.includes('que tienen') || 
             mensaje.includes('catalogo') || mensaje.includes('menu') ||
             mensaje.includes('que venden')) {
      respuesta = `🛒 *Productos SuperCasa*

🥗 **Mercado:** Frutas, verduras, lácteos, carnes
🧴 **Aseo:** Detergente, jabón, shampoo, papel
🥤 **Bebidas:** Gaseosas, jugos, agua, cerveza
🍿 **Snacks:** Papas, galletas, dulces, helados

🛍️ **Ver todo y hacer pedidos:**
👉 https://tiendasupercasa.com

🚀 ¡Entrega en máximo 20 minutos!
🚚 ¡Domicilio GRATIS dentro del conjunto!`;
    }
    // 3. HORARIOS/INFO
    else if (mensaje.includes('horario') || mensaje.includes('hora') || 
             mensaje.includes('cuando') || mensaje.includes('atencion') ||
             mensaje.includes('abrir')) {
      respuesta = `🕐 *Horarios SuperCasa*

📅 **Lunes a Domingo:** 6:00 AM - 11:00 PM
⚡ **Entrega:** Máximo 20 minutos
🏗️ **Cobertura:** Torres 1, 2, 3, 4, 5 (Bellavista)
💳 **Pagos:** Nequi, PSE, Tarjetas, Efectivo
🚚 **Domicilio:** ¡GRATIS!
📞 **WhatsApp:** 300 139 9242

¿Algo más en lo que pueda ayudarte? 😊`;
    }
    // 4. SALUDO/AYUDA
    else if (mensaje.includes('hola') || mensaje.includes('ayuda') || 
             mensaje.includes('info') || mensaje.includes('help') ||
             mensaje.includes('buenos') || mensaje.includes('buenas')) {
      respuesta = `¡Hola! 👋 Soy el asistente de *SuperCasa* 🏠

🛒 **Tu supermercado en casa en 20 minutos**

Puedo ayudarte con:
- 📦 Consultar pedidos (envía: SUP-123)
- 🛍️ Ver productos disponibles
- 🕐 Horarios y información
- 📞 Soporte directo

🛍️ **Hacer pedidos:**
👉 https://tiendasupercasa.com

¿En qué puedo ayudarte hoy? 😊`;
    }
    // 5. RESPUESTA GENÉRICA
    else {
      respuesta = `🤖 ¡Hola! Soy el asistente de *SuperCasa* 🏠

No entendí exactamente tu consulta, pero puedo ayudarte con:

📦 **Consultar pedido:** Envía "SUP-123"
🛒 **Ver productos:** Envía "productos"
🕐 **Horarios:** Envía "horarios"  
💳 **Pagos:** Envía "pagos"

🛍️ **O haz tu pedido directamente:**
👉 https://tiendasupercasa.com

¿Puedes ser más específico? 😊`;
    }

    // ✅ ENVIAR RESPUESTA SI HAY UNA
    if (respuesta) {
      await enviarRespuestaWhatsAppProduccion(fromWhatsApp, respuesta);
      
      // Log respuesta enviada
      await pool.query(
        'INSERT INTO whatsapp_logs (telefono, mensaje, tipo, status) VALUES ($1, $2, $3, $4)',
        [telefono, respuesta, 'bot_response', 'sent']
      );
    }

    // Log mensaje entrante SIEMPRE
    await pool.query(
      'INSERT INTO whatsapp_logs (telefono, mensaje, tipo, status) VALUES ($1, $2, $3, $4)',
      [telefono, mensajeOriginal, 'incoming', 'received']
    );

  } catch (error) {
    console.error('❌ Error procesando mensaje WhatsApp:', error);
  }
}

// ===================================
// 🔍 FUNCIÓN CONSULTAR PEDIDO CORREGIDA
// ===================================
async function consultarPedidoWhatsApp(pedidoNumero, telefono) {
  try {
    const pedidoResult = await pool.query(`
      SELECT 
  p.*, u.nombre,
  EXTRACT(EPOCH FROM (NOW() - p.fecha))/60 as minutos_transcurridos
FROM pedidos p
JOIN usuarios u ON p.usuario_id = u.id
WHERE p.id = $1 AND (p.telefono_contacto = $2 OR u.telefono = $2)
    `, [pedidoNumero, telefono]);

    if (pedidoResult.rows.length === 0) {
      return `❌ No encontré el pedido SUP-${pedidoNumero} asociado a este número.

🔍 **Verifica:**
- ¿Es el número correcto del pedido?
- ¿Usaste el mismo teléfono al pedir?

🛍️ **¿Primer pedido?**
👉 https://tiendasupercasa.com

¿Necesitas ayuda? Envía "ayuda" 😊`;
    }

    const pedido = pedidoResult.rows[0];
    // ✅ USAR LA MISMA LÓGICA QUE EN LA CONSULTA PRINCIPAL
const tiempoTranscurrido = Math.round(pedido.minutos_transcurridos || 0);
    const direccion = pedido.torre_entrega ? 
      `Torre ${pedido.torre_entrega}, Piso ${pedido.piso_entrega}, Apt ${pedido.apartamento_entrega}` : 
      'Dirección por confirmar';

    let estadoEmoji = '';
    let estadoMensaje = '';

    switch (pedido.estado.toLowerCase()) {
      case 'pendiente':
        estadoEmoji = tiempoTranscurrido < 20 ? '🚀' : '⚠️';
        estadoMensaje = tiempoTranscurrido < 20 ? 
          '¡En preparación! Entrega en máximo 20 min' : 
          'Revisando tiempo de entrega...';
        break;
      case 'procesando':
        estadoEmoji = '👨‍🍳';
        estadoMensaje = '¡Preparando tu pedido!';
        break;
      case 'enviado':
        estadoEmoji = '🚚';
        estadoMensaje = '¡En camino a tu torre!';
        break;
      case 'entregado':
        estadoEmoji = '✅';
        estadoMensaje = '¡Pedido entregado exitosamente!';
        break;
      case 'cancelado':
        estadoEmoji = '❌';
        estadoMensaje = 'Pedido cancelado';
        break;
      default:
        estadoEmoji = '📦';
        estadoMensaje = 'Estado en revisión';
    }

    return `📦 *Pedido SUP-${pedidoNumero}*

👤 **Cliente:** ${pedido.nombre}
💰 **Total:** $${Number(pedido.total).toLocaleString('es-CO')}
📍 **Entrega:** ${direccion}
📊 **Estado:** ${estadoEmoji} ${pedido.estado.toUpperCase()}
⏰ **Tiempo:** Hace ${tiempoTranscurrido} min

${estadoEmoji} ${estadoMensaje}

${pedido.estado === 'entregado' ? 
  '¡Gracias por elegirnos! 😊' : 
  '¿Alguna pregunta? ¡Estoy aquí! 💬'}`;

  } catch (error) {
    console.error('❌ Error consultando pedido:', error);
    return `❌ Error consultando el pedido SUP-${pedidoNumero}.

Por favor intenta de nuevo o contacta soporte.
📞 WhatsApp: 300 139 9242`;
  }
}

// ===================================
// 📤 FUNCIÓN ENVIAR RESPUESTA CORREGIDA
// ===================================
async function enviarRespuestaWhatsAppProduccion(toWhatsApp, mensaje) {
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    // Las respuestas del bot SIEMPRE son en sesión activa (el usuario escribió primero)
    const message = await twilioClient.messages.create({
      body: mensaje,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: toWhatsApp
    });

    console.log(`✅ Respuesta bot enviada: ${message.sid}`);
    return message.sid;

  } catch (error) {
    console.error('❌ Error enviando respuesta bot:', error);
    throw error;
  }
}

// ===================================
// 🔔 WEBHOOK STATUS (ENTREGA DE MENSAJES)
// ===================================
app.post('/webhook/whatsapp/status', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { MessageSid, MessageStatus } = req.body;
    
    console.log(`📊 Status update: ${MessageSid} = ${MessageStatus}`);

    if (MessageStatus === 'delivered') {
      // Actualizar pedido como delivered
      await pool.query(
        'UPDATE pedidos SET whatsapp_status = $1, whatsapp_delivered_at = CURRENT_TIMESTAMP WHERE whatsapp_message_sid = $2',
        ['delivered', MessageSid]
      );

      console.log(`✅ Mensaje ${MessageSid} marcado como entregado`);
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Error en webhook status:', error);
    res.status(500).send('Error');
  }
});

// ===================================
// 🧪 ENDPOINTS DE TEST Y DEBUG
// ===================================
app.get('/debug-twilio', (req, res) => {
  res.json({
    account_sid: process.env.TWILIO_ACCOUNT_SID ? 'CONFIGURADO' : 'FALTANTE',
    auth_token: process.env.TWILIO_AUTH_TOKEN ? 'CONFIGURADO' : 'FALTANTE', 
    whatsapp_number: process.env.TWILIO_WHATSAPP_NUMBER,
    account_sid_preview: process.env.TWILIO_ACCOUNT_SID?.substring(0, 10) + '...',
    auth_token_preview: process.env.TWILIO_AUTH_TOKEN?.substring(0, 10) + '...'
  });
});

app.get('/test-whatsapp-prod', async (req, res) => {
  try {
    console.log('🧪 Probando WhatsApp en producción...');
    
    const message = await twilioClient.messages.create({
      body: '🏗️ SuperCasa - Sistema WhatsApp funcionando en producción!',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: 'whatsapp:+573001399242'
    });

    console.log(`✅ WhatsApp enviado: ${message.sid}`);
    res.json({ success: true, messageSid: message.sid });
    
  } catch (error) {
    console.error('❌ Error WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/test-whatsapp', async (req, res) => {
  try {
    console.log('🧪 Probando WhatsApp...');
    
    const message = await twilioClient.messages.create({
      body: '🧪 TEST SuperCasa - Si recibes esto, WhatsApp funciona!',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: 'whatsapp:+573001399242'
    });

    console.log(`✅ Mensaje test enviado: ${message.sid}`);
    res.json({ success: true, messageSid: message.sid });
    
  } catch (error) {
    console.error('❌ Error test WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===================================
// 🧪 ENDPOINTS DE TEST WHATSAPP
// ===================================

// Test confirmación con template
app.get('/test-whatsapp-template', async (req, res) => {
  try {
    console.log('🧪 Probando template confirmación...');
    
    const testPedido = {
      id: 999,
      total: 25500,
      telefono_contacto: '3001399242',  // Cambia por tu número
      torre_entrega: '1',
      piso_entrega: 5,
      apartamento_entrega: '501',
      productos: [
        { nombre: 'Producto Test', cantidad: 2 },
        { nombre: 'Otro Test', cantidad: 1 }
      ]
    };
    
    const result = await enviarConfirmacionWhatsApp(testPedido);
    
    res.json({ 
      success: result.success, 
      messageSid: result.messageSid,
      error: result.error
    });
    
  } catch (error) {
    console.error('❌ Error test template:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test mensaje libre
app.get('/test-whatsapp-libre', async (req, res) => {
  try {
    console.log('🧪 Probando mensaje libre...');
    
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    const message = await twilioClient.messages.create({
      body: '🧪 TEST SuperCasa - Mensaje libre (solo funciona si hay sesión activa)',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: 'whatsapp:+573001399242'  // Cambia por tu número
    });

    console.log(`✅ Mensaje libre enviado: ${message.sid}`);
    res.json({ success: true, messageSid: message.sid });
    
  } catch (error) {
    console.error('❌ Error mensaje libre:', error);
    res.status(500).json({ error: error.message });
  }
});

// ENDPOINT TEMPORAL PARA PROBAR (BORRAR DESPUÉS)
app.get('/test-margenes', async (req, res) => {
  try {
    const productos = await pool.query('SELECT COUNT(*) as total FROM productos');
    const gastos = await pool.query('SELECT COUNT(*) as total FROM gastos_operativos');
    
    res.json({
      test: 'Sistema de márgenes funcionando',
      productos_total: productos.rows[0].total,
      gastos_total: gastos.rows[0].total,
      endpoints_disponibles: [
        '/api/admin/rentabilidad/dashboard',
        '/api/admin/productos/margenes',
        '/api/admin/gastos'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ RECREAR VISTA CON IMÁGENES
pool.query(`
  DROP VIEW IF EXISTS vista_paquetes_completos;
  CREATE VIEW vista_paquetes_completos AS
  SELECT 
    p.id, p.nombre, p.descripcion, p.precio_paquete, p.categoria, p.imagen, p.activo, p.fecha_inicio, p.fecha_fin,
    COALESCE(SUM(prod.precio * pp.cantidad), 0) as precio_individual_total,
    COALESCE(SUM(prod.precio * pp.cantidad), 0) - p.precio_paquete as ahorro_monto,
    ROUND(((COALESCE(SUM(prod.precio * pp.cantidad), 0) - p.precio_paquete) / NULLIF(COALESCE(SUM(prod.precio * pp.cantidad), 0), 0)) * 100, 2) as ahorro_porcentaje,
    JSON_AGG(JSON_BUILD_OBJECT('producto_id', prod.id, 'nombre', prod.nombre, 'precio', prod.precio, 'cantidad', pp.cantidad, 'stock', prod.stock, 'imagen', prod.imagen, 'subtotal', prod.precio * pp.cantidad) ORDER BY prod.nombre) as productos_incluidos,
    CASE WHEN COUNT(prod.id) = 0 THEN 0 ELSE MIN(FLOOR(prod.stock / pp.cantidad)) END as stock_paquetes_disponibles
  FROM paquetes p
  LEFT JOIN paquete_productos pp ON p.id = pp.paquete_id
  LEFT JOIN productos prod ON pp.producto_id = prod.id
  GROUP BY p.id, p.nombre, p.descripcion, p.precio_paquete, p.categoria, p.imagen, p.activo, p.fecha_inicio, p.fecha_fin;
`).then(() => console.log("✅ Vista paquetes actualizada con imágenes"))
  .catch(err => console.log("⚠️ Error actualizando vista:", err.message));

console.log('✅ WhatsApp PRODUCCIÓN con Templates configurado');
console.log('🔗 Webhook: https://supercasa-backend-vvu1.onrender.com/webhook/whatsapp');
console.log('📝 Templates requeridos para confirmaciones automáticas');
console.log('🤖 Bot responde en sesiones activas');


console.log('📱 WhatsApp Business configurado para SuperCasa');
console.log('🔗 Webhook: /webhook/whatsapp');
console.log('📞 Número: 3001399242');
console.log('🤖 Bot inteligente activado');


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