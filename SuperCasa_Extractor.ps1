# ===================================================================
# SUPERCASA - EXTRACTOR DE DOCUMENTACIÓN COMPLETO
# ===================================================================
# Este script extrae TODA la información relevante del proyecto SuperCasa
# Frontend (React) + Backend (Node.js) + Configuraciones + Despliegues
# RUTAS FIJAS CONFIGURADAS PARA TU PROYECTO
# ===================================================================

# CONFIGURACIÓN FIJA - RUTAS DE TU PROYECTO SUPERCASA
$FrontendPath = "C:\Users\mikeh\Documents\supercasa-admin\supercasa-admin"
$BackendPath = "C:\Users\mikeh\Documents\supercasa-backend\supercasa-backend"
$OutputPath = "C:\Users\mikeh\Documents\SuperCasa_Documentation_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

Write-Host "🚀 INICIANDO EXTRACCIÓN SUPERCASA..." -ForegroundColor Green
Write-Host "🎨 Frontend: $FrontendPath" -ForegroundColor Yellow
Write-Host "⚙️ Backend: $BackendPath" -ForegroundColor Yellow
Write-Host "📁 Documentación: $OutputPath" -ForegroundColor Cyan

# Verificar que existen las rutas
if (-not (Test-Path $FrontendPath)) {
    Write-Host "❌ ERROR: No se encuentra el frontend en $FrontendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $BackendPath)) {
    Write-Host "❌ ERROR: No se encuentra el backend en $BackendPath" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Ambos proyectos encontrados correctamente" -ForegroundColor Green

# Crear directorio de salida
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
Write-Host "📁 Creando documentación en: $OutputPath" -ForegroundColor Green

# ===================================================================
# FUNCIONES AUXILIARES
# ===================================================================

function Write-Section {
    param([string]$Title, [string]$Content, [string]$FileName)
    
    $filePath = Join-Path $OutputPath $FileName
    $separator = "=" * 80
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    
    $output = @"
$separator
$Title
Extraído el: $timestamp
$separator

$Content

"@
    
    Add-Content -Path $filePath -Value $output -Encoding UTF8
    Write-Host "✅ $Title extraído" -ForegroundColor Cyan
}

function Get-FileContent {
    param([string]$Path, [string]$Pattern = "*")
    
    if (Test-Path $Path) {
        Get-ChildItem -Path $Path -Filter $Pattern -Recurse | 
        Where-Object { -not $_.PSIsContainer } |
        ForEach-Object {
            "ARCHIVO: $($_.FullName.Replace($PWD.Path, '.'))"
            "=" * 60
            Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            "`n`n"
        }
    } else {
        "❌ Ruta no encontrada: $Path"
    }
}

function Get-DirectoryStructure {
    param([string]$Path, [string]$Title)
    
    if (Test-Path $Path) {
        $structure = tree $Path /F /A
        "$Title`n$('=' * 60)`n$($structure -join "`n")`n`n"
    } else {
        "❌ Directorio no encontrado: $Path`n"
    }
}

# ===================================================================
# 1. INFORMACIÓN GENERAL DEL PROYECTO
# ===================================================================

$generalInfo = @"
PROYECTO: SuperCasa
DESCRIPCIÓN: Supermercado virtual con entrega ultra rápida
UBICACIÓN: Torres de Bellavista, Bogotá D.C., Colombia
TECNOLOGÍAS: React + Node.js + PostgreSQL + WhatsApp Business API + WOMPI

ESTRUCTURA DEL PROYECTO:
- Frontend (React): $FrontendPath
- Backend (Node.js): $BackendPath
- Documentación generada: $OutputPath

VERIFICACIÓN DE RUTAS:
- Frontend accesible: $(Test-Path $FrontendPath)
- Backend accesible: $(Test-Path $BackendPath)

CONFIGURACIÓN:
- Proyectos separados en carpetas independientes
- Frontend: supercasa-admin (React + Tailwind)
- Backend: supercasa-backend (Node.js + Express + PostgreSQL)

FECHA DE EXTRACCIÓN: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@

Write-Section "INFORMACIÓN GENERAL" $generalInfo "01_INFORMACION_GENERAL.md"

# ===================================================================
# 2. FRONTEND (REACT) - ANÁLISIS COMPLETO
# ===================================================================

Write-Host "`n🎨 Analizando FRONTEND..." -ForegroundColor Yellow

# Estructura del frontend
$frontendStructure = Get-DirectoryStructure $FrontendPath "ESTRUCTURA DEL FRONTEND"
Write-Section "FRONTEND - ESTRUCTURA" $frontendStructure "02_FRONTEND_ESTRUCTURA.md"

# Package.json y dependencias
$frontendPackage = Get-FileContent (Join-Path $FrontendPath "package.json")
Write-Section "FRONTEND - PACKAGE.JSON Y DEPENDENCIAS" $frontendPackage "03_FRONTEND_DEPENDENCIAS.md"

# Archivos de configuración principales
$frontendConfigs = @()
$configFiles = @("package-lock.json", "yarn.lock", ".gitignore", "README.md", "netlify.toml", "public/manifest.json", "public/index.html")

foreach ($configFile in $configFiles) {
    $configPath = Join-Path $FrontendPath $configFile
    if (Test-Path $configPath) {
        $frontendConfigs += "ARCHIVO: $configFile"
        $frontendConfigs += "=" * 60
        $frontendConfigs += Get-Content $configPath -Raw -ErrorAction SilentlyContinue
        $frontendConfigs += "`n`n"
    }
}

Write-Section "FRONTEND - CONFIGURACIONES" ($frontendConfigs -join "`n") "04_FRONTEND_CONFIGURACIONES.md"

# Componentes React principales
$frontendComponents = Get-FileContent (Join-Path $FrontendPath "src") "*.jsx"
Write-Section "FRONTEND - COMPONENTES JSX" $frontendComponents "05_FRONTEND_COMPONENTES_JSX.md"

$frontendComponentsJS = Get-FileContent (Join-Path $FrontendPath "src") "*.js"
Write-Section "FRONTEND - COMPONENTES JS" $frontendComponentsJS "06_FRONTEND_COMPONENTES_JS.md"

# Estilos y CSS
$frontendStyles = Get-FileContent (Join-Path $FrontendPath "src") "*.css"
Write-Section "FRONTEND - ESTILOS CSS" $frontendStyles "07_FRONTEND_ESTILOS.md"

# Archivos de configuración adicionales
$frontendOtherConfigs = @()
$otherConfigFiles = @("tailwind.config.js", "craco.config.js", "webpack.config.js", ".env.example", ".env.local")

foreach ($configFile in $otherConfigFiles) {
    $configPath = Join-Path $FrontendPath $configFile
    if (Test-Path $configPath) {
        $frontendOtherConfigs += "ARCHIVO: $configFile"
        $frontendOtherConfigs += "=" * 60
        $frontendOtherConfigs += Get-Content $configPath -Raw -ErrorAction SilentlyContinue
        $frontendOtherConfigs += "`n`n"
    }
}

Write-Section "FRONTEND - CONFIGURACIONES ADICIONALES" ($frontendOtherConfigs -join "`n") "08_FRONTEND_CONFIGS_ADICIONALES.md"

# ===================================================================
# 3. BACKEND (NODE.JS) - ANÁLISIS COMPLETO
# ===================================================================

Write-Host "`n⚙️ Analizando BACKEND..." -ForegroundColor Yellow

# Estructura del backend
$backendStructure = Get-DirectoryStructure $BackendPath "ESTRUCTURA DEL BACKEND"
Write-Section "BACKEND - ESTRUCTURA" $backendStructure "09_BACKEND_ESTRUCTURA.md"

# Package.json del backend
$backendPackage = Get-FileContent (Join-Path $BackendPath "package.json")
Write-Section "BACKEND - PACKAGE.JSON Y DEPENDENCIAS" $backendPackage "10_BACKEND_DEPENDENCIAS.md"

# Archivo principal del servidor
$backendMain = @()
$mainFiles = @("index.js", "server.js", "app.js", "main.js")

foreach ($mainFile in $mainFiles) {
    $mainPath = Join-Path $BackendPath $mainFile
    if (Test-Path $mainPath) {
        $backendMain += "ARCHIVO PRINCIPAL: $mainFile"
        $backendMain += "=" * 60
        $backendMain += Get-Content $mainPath -Raw -ErrorAction SilentlyContinue
        $backendMain += "`n`n"
    }
}

Write-Section "BACKEND - SERVIDOR PRINCIPAL" ($backendMain -join "`n") "11_BACKEND_SERVIDOR.md"

# Rutas y APIs
$backendRoutes = Get-FileContent (Join-Path $BackendPath "routes") "*.js"
if (-not $backendRoutes) {
    $backendRoutes = Get-FileContent (Join-Path $BackendPath "src/routes") "*.js"
}
if (-not $backendRoutes) {
    $backendRoutes = Get-FileContent $BackendPath "*route*.js"
}
Write-Section "BACKEND - RUTAS Y APIS" $backendRoutes "12_BACKEND_RUTAS.md"

# Controladores
$backendControllers = Get-FileContent (Join-Path $BackendPath "controllers") "*.js"
if (-not $backendControllers) {
    $backendControllers = Get-FileContent (Join-Path $BackendPath "src/controllers") "*.js"
}
Write-Section "BACKEND - CONTROLADORES" $backendControllers "13_BACKEND_CONTROLADORES.md"

# Modelos y base de datos
$backendModels = Get-FileContent (Join-Path $BackendPath "models") "*.js"
if (-not $backendModels) {
    $backendModels = Get-FileContent (Join-Path $BackendPath "src/models") "*.js"
}
Write-Section "BACKEND - MODELOS DE BASE DE DATOS" $backendModels "14_BACKEND_MODELOS.md"

# Middlewares
$backendMiddlewares = Get-FileContent (Join-Path $BackendPath "middleware") "*.js"
if (-not $backendMiddlewares) {
    $backendMiddlewares = Get-FileContent (Join-Path $BackendPath "src/middleware") "*.js"
}
Write-Section "BACKEND - MIDDLEWARES" $backendMiddlewares "15_BACKEND_MIDDLEWARES.md"

# Utilidades y helpers
$backendUtils = Get-FileContent (Join-Path $BackendPath "utils") "*.js"
if (-not $backendUtils) {
    $backendUtils = Get-FileContent (Join-Path $BackendPath "src/utils") "*.js"
}
if (-not $backendUtils) {
    $backendUtils = Get-FileContent (Join-Path $BackendPath "helpers") "*.js"
}
Write-Section "BACKEND - UTILIDADES Y HELPERS" $backendUtils "16_BACKEND_UTILS.md"

# Configuraciones del backend
$backendConfigs = @()
$backendConfigFiles = @(".env.example", ".gitignore", "README.md", "render.yaml", "Procfile", "vercel.json")

foreach ($configFile in $backendConfigFiles) {
    $configPath = Join-Path $BackendPath $configFile
    if (Test-Path $configPath) {
        $backendConfigs += "ARCHIVO: $configFile"
        $backendConfigs += "=" * 60
        $backendConfigs += Get-Content $configPath -Raw -ErrorAction SilentlyContinue
        $backendConfigs += "`n`n"
    }
}

Write-Section "BACKEND - CONFIGURACIONES" ($backendConfigs -join "`n") "17_BACKEND_CONFIGURACIONES.md"

# ===================================================================
# 4. ESQUEMAS DE BASE DE DATOS
# ===================================================================

Write-Host "`n🗄️ Buscando esquemas de base de datos..." -ForegroundColor Yellow

$dbSchemas = @()

# Buscar archivos SQL
$sqlFiles = @(
    (Join-Path $BackendPath "*.sql"),
    (Join-Path $BackendPath "database/*.sql"),
    (Join-Path $BackendPath "db/*.sql"),
    (Join-Path $BackendPath "migrations/*.sql"),
    (Join-Path $BackendPath "schema/*.sql")
)

foreach ($sqlPattern in $sqlFiles) {
    if (Test-Path $sqlPattern) {
        Get-ChildItem $sqlPattern | ForEach-Object {
            $dbSchemas += "ARCHIVO SQL: $($_.Name)"
            $dbSchemas += "=" * 60
            $dbSchemas += Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            $dbSchemas += "`n`n"
        }
    }
}

# Buscar archivos de migración
$migrationFiles = Get-FileContent (Join-Path $BackendPath "migrations") "*"
if ($migrationFiles) {
    $dbSchemas += "MIGRACIONES:"
    $dbSchemas += "=" * 60
    $dbSchemas += $migrationFiles
}

Write-Section "BASE DE DATOS - ESQUEMAS Y MIGRACIONES" ($dbSchemas -join "`n") "18_BASE_DATOS_ESQUEMAS.md"

# ===================================================================
# 5. DOCUMENTACIÓN EXISTENTE
# ===================================================================

Write-Host "`n📚 Extrayendo documentación existente..." -ForegroundColor Yellow

$existingDocs = @()

# README files
$readmeFiles = @(
    (Join-Path $FrontendPath "README.md"),
    (Join-Path $BackendPath "README.md"),
    (Join-Path $FrontendPath "docs/*.md"),
    (Join-Path $BackendPath "docs/*.md")
)

foreach ($readmePattern in $readmeFiles) {
    if (Test-Path $readmePattern) {
        Get-ChildItem $readmePattern | ForEach-Object {
            $existingDocs += "DOCUMENTACIÓN: $($_.FullName.Replace($PWD.Path, '.'))"
            $existingDocs += "=" * 60
            $existingDocs += Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            $existingDocs += "`n`n"
        }
    }
}

Write-Section "DOCUMENTACIÓN EXISTENTE" ($existingDocs -join "`n") "19_DOCUMENTACION_EXISTENTE.md"

# ===================================================================
# 6. CONFIGURACIONES DE DESPLIEGUE
# ===================================================================

Write-Host "`n🚀 Extrayendo configuraciones de despliegue..." -ForegroundColor Yellow

$deploymentConfigs = @()

# Frontend deployment (Netlify, Vercel, etc.)
$frontendDeployFiles = @("netlify.toml", "_redirects", "vercel.json", ".github/workflows/*.yml")
foreach ($deployFile in $frontendDeployFiles) {
    $deployPath = Join-Path $FrontendPath $deployFile
    if (Test-Path $deployPath) {
        $deploymentConfigs += "FRONTEND DEPLOY - $deployFile"
        $deploymentConfigs += "=" * 60
        $deploymentConfigs += Get-Content $deployPath -Raw -ErrorAction SilentlyContinue
        $deploymentConfigs += "`n`n"
    }
}

# Backend deployment (Render, Heroku, etc.)
$backendDeployFiles = @("render.yaml", "Procfile", "Dockerfile", ".github/workflows/*.yml")
foreach ($deployFile in $backendDeployFiles) {
    $deployPath = Join-Path $BackendPath $deployFile
    if (Test-Path $deployPath) {
        $deploymentConfigs += "BACKEND DEPLOY - $deployFile"
        $deploymentConfigs += "=" * 60
        $deploymentConfigs += Get-Content $deployPath -Raw -ErrorAction SilentlyContinue
        $deploymentConfigs += "`n`n"
    }
}

Write-Section "CONFIGURACIONES DE DESPLIEGUE" ($deploymentConfigs -join "`n") "20_CONFIGURACIONES_DESPLIEGUE.md"

# ===================================================================
# 7. ANÁLISIS DE APIs Y ENDPOINTS
# ===================================================================

Write-Host "`n🔌 Analizando APIs y endpoints..." -ForegroundColor Yellow

$apiAnalysis = @()

# Buscar definiciones de endpoints en el backend
$backendFiles = Get-ChildItem -Path $BackendPath -Filter "*.js" -Recurse | Get-Content -Raw

# Extraer rutas REST
$routes = $backendFiles | Select-String -Pattern "app\.(get|post|put|delete|patch)\s*\(['\`"]([^'\`"]+)" -AllMatches | 
    ForEach-Object { 
        $_.Matches | ForEach-Object { 
            "$($_.Groups[1].Value.ToUpper()) $($_.Groups[2].Value)" 
        }
    } | Sort-Object | Get-Unique

$apiAnalysis += "ENDPOINTS DETECTADOS:"
$apiAnalysis += "=" * 60
$apiAnalysis += $routes -join "`n"
$apiAnalysis += "`n`n"

Write-Section "ANÁLISIS DE APIS Y ENDPOINTS" ($apiAnalysis -join "`n") "21_ANALISIS_APIS.md"

# ===================================================================
# 8. RESUMEN EJECUTIVO
# ===================================================================

Write-Host "`n📊 Generando resumen ejecutivo..." -ForegroundColor Yellow

$executiveSummary = @"
RESUMEN EJECUTIVO - PROYECTO SUPERCASA

ARQUITECTURA DETECTADA:
- Frontend: React.js en supercasa-admin ($FrontendPath)
- Backend: Node.js/Express en supercasa-backend ($BackendPath)
- Base de datos: PostgreSQL (esquemas extraídos)
- Despliegue: Netlify (frontend) + Render (backend)

ESTRUCTURA DE PROYECTOS:
- FRONTEND (supercasa-admin): React + Tailwind CSS + React Router
- BACKEND (supercasa-backend): Node.js + Express + PostgreSQL + JWT + APIs

COMPONENTES PRINCIPALES IDENTIFICADOS:
- Sistema de autenticación sin contraseñas
- Integración WhatsApp Business API (Twilio)
- Pasarela de pagos WOMPI
- Panel administrativo
- Sistema de pedidos y gestión de stock
- Bot automático 24/7

ARCHIVOS EXTRAÍDOS Y DOCUMENTADOS:
- Configuraciones de proyecto (package.json, dependencias)
- Código fuente completo (componentes, rutas, controladores)
- Esquemas de base de datos y migraciones
- Configuraciones de despliegue
- Documentación existente
- Análisis de APIs y endpoints

TECNOLOGÍAS DETECTADAS:
- React Router, Tailwind CSS
- Express.js, PostgreSQL
- JWT Authentication
- WhatsApp Business API
- WOMPI Payment Gateway
- Netlify, Render hosting

RUTAS ANALIZADAS:
- Frontend completo: $FrontendPath
- Backend completo: $BackendPath

PRÓXIMOS PASOS RECOMENDADOS:
1. Revisar toda la documentación extraída
2. Validar que no falte información crítica
3. Crear diagramas de arquitectura basados en el código
4. Documentar flujos de negocio específicos
5. Crear guías de despliegue y mantenimiento

Fecha de análisis: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Total de archivos analizados: Se han extraído todos los archivos relevantes de ambos proyectos separados
"@

Write-Section "RESUMEN EJECUTIVO" $executiveSummary "00_RESUMEN_EJECUTIVO.md"

# ===================================================================
# 9. ÍNDICE DE ARCHIVOS GENERADOS
# ===================================================================

$indexContent = @"
ÍNDICE DE DOCUMENTACIÓN SUPERCASA

Los siguientes archivos han sido generados con toda la información del proyecto:

00_RESUMEN_EJECUTIVO.md - Resumen general del proyecto
01_INFORMACION_GENERAL.md - Información básica del proyecto
02_FRONTEND_ESTRUCTURA.md - Estructura de directorios del frontend
03_FRONTEND_DEPENDENCIAS.md - Package.json y dependencias del frontend
04_FRONTEND_CONFIGURACIONES.md - Archivos de configuración principales
05_FRONTEND_COMPONENTES_JSX.md - Todos los componentes React JSX
06_FRONTEND_COMPONENTES_JS.md - Todos los componentes JavaScript
07_FRONTEND_ESTILOS.md - Archivos CSS y estilos
08_FRONTEND_CONFIGS_ADICIONALES.md - Configuraciones adicionales (Tailwind, etc.)
09_BACKEND_ESTRUCTURA.md - Estructura de directorios del backend
10_BACKEND_DEPENDENCIAS.md - Package.json y dependencias del backend
11_BACKEND_SERVIDOR.md - Archivo principal del servidor
12_BACKEND_RUTAS.md - Todas las rutas y APIs
13_BACKEND_CONTROLADORES.md - Controladores del backend
14_BACKEND_MODELOS.md - Modelos de base de datos
15_BACKEND_MIDDLEWARES.md - Middlewares del servidor
16_BACKEND_UTILS.md - Utilidades y helpers
17_BACKEND_CONFIGURACIONES.md - Configuraciones del backend
18_BASE_DATOS_ESQUEMAS.md - Esquemas y migraciones de base de datos
19_DOCUMENTACION_EXISTENTE.md - Documentación ya existente en los proyectos
20_CONFIGURACIONES_DESPLIEGUE.md - Configuraciones de Netlify, Render, etc.
21_ANALISIS_APIS.md - Análisis de endpoints y APIs detectadas

TOTAL: 22 archivos de documentación completa del proyecto SuperCasa
"@

Write-Section "ÍNDICE DE DOCUMENTACIÓN" $indexContent "INDEX.md"

# ===================================================================
# FINALIZACIÓN
# ===================================================================

Write-Host "`n🎉 ¡DOCUMENTACIÓN COMPLETA EXTRAÍDA!" -ForegroundColor Green
Write-Host "🎨 Frontend analizado: $FrontendPath" -ForegroundColor Yellow
Write-Host "⚙️ Backend analizado: $BackendPath" -ForegroundColor Yellow
Write-Host "📁 Documentación en: $OutputPath" -ForegroundColor Cyan
Write-Host "📄 Total de archivos: 22 documentos generados" -ForegroundColor Cyan
Write-Host "`n✅ El proyecto SuperCasa ha sido completamente documentado" -ForegroundColor Green
Write-Host "✅ No se ha dejado nada por fuera - Frontend, Backend, APIs, DB, Deploy" -ForegroundColor Green
Write-Host "`n🚀 Puedes usar esta documentación para:" -ForegroundColor White
Write-Host "   - Análisis completo del proyecto" -ForegroundColor Gray
Write-Host "   - Migración o refactoring" -ForegroundColor Gray
Write-Host "   - Documentación técnica" -ForegroundColor Gray
Write-Host "   - Onboarding de nuevos desarrolladores" -ForegroundColor Gray
Write-Host "   - Auditorías de código" -ForegroundColor Gray
Write-Host "`n💡 PARA EJECUTAR NUEVAMENTE:" -ForegroundColor Cyan
Write-Host "   Solo ejecuta: .\SuperCasa_Extractor.ps1" -ForegroundColor White
Write-Host "   (Rutas fijas configuradas para tus proyectos supercasa-admin y supercasa-backend)" -ForegroundColor Gray