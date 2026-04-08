# Sistema ESI

Sistema web para criação de obras, composição técnica de projetos e salas, cálculo de climatização e ventilação, gestão de catálogos do sistema e exportação de documentos Word com envio por email.

O projeto combina:

- frontend em JavaScript modular, sem framework SPA tradicional;
- backend Python com servidor HTTP proprio;
- persistencia principal em PostgreSQL hospedado no Supabase;
- snapshot offline local em SQLite para operacao e contingencia fora do ambiente online;
- servidor online hospedado por render.com [https://app-esienergia.onrender.com];
- autenticacao para cliente e administrador;
- exportacao de propostas tecnicas e comerciais;
- sincronizacao de empresas, credenciais de acesso, catalogos, obras e sessoes;
- reconciliacao assincrona entre banco online e snapshot offline local.

## Visão geral

O fluxo principal do produto é:

1. cadastrar ou abrir uma obra;
2. vincular a obra a uma empresa;
3. cadastrar dados da empresa;
4. montar projetos e salas;
5. preencher dados técnicos;
6. calcular carga térmica, ventilação e solução de máquinas;
7. salvar a obra;
8. exportar PT/PC por download e/ou email.

Além disso, o sistema possui um painel administrativo para editar os bancos internos:

- credenciais ADM;
- configuração SMTP(credencial de envio de email);
- empresas;
- máquinas;
- materiais;
- acessórios;
- dutos;
- tubos;
- constantes;

## Perfis de uso

Na prática, o sistema trabalha com 3 perfis de operação, embora o frontend principal use 2 modos de execução (`user` e `client`).

### 1. Cliente

Perfil autenticado por usuário + token da empresa.

Características:

- entra pela tela de login;
- acessa apenas a própria empresa;
- a empresa fica travada no formulário;
- não vê o painel de edição de dados;
- não usa filtros globais de obras;
- pode criar/editar obras dentro do contexto da empresa autenticada;
- pode recuperar token por email, se houver email de recuperação cadastrado;
- ao salvar obra, dispara notificação com email da obra anexada ao ADM.

### 2. Usuário interno / operação

É o uso interno do módulo de criação de obras em modo `user`.

Características:

- acesso amplo à tela de obras;
- pode escolher qualquer empresa;
- pode usar filtros;
- pode acessar a navegação administrativa;
- pode preencher dados de credenciais da empresa diretamente no cadastro da obra;
- pode exportar documentos e enviar email.

### 3. Administrador

É o perfil com login administrativo, redirecionado para o ambiente `/admin`.

Características:

- acessa o cadastro de obras pelo caminho administrativo;
- acessa o painel `/admin/data`;
- gerencia credenciais ADM;
- configura o remetente SMTP;
- altera os bancos estruturais do sistema;
- cria, edita ou remove credenciais de acesso das empresas.

## Modos do frontend

### Modo `user`

Configuração padrão do app principal.

Comportamento:

- autenticação de cliente desativada;
- filtros habilitados;
- navegação para editar dados habilitada;
- botão de desligar servidor habilitado;
- empresa livre no formulário.

Arquivo-base:

- [config.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/core/config.js)

### Modo `client`

Ativado por `window.__APP_CONFIG_OVERRIDES__` nas páginas de login e obra do cliente.

Comportamento:

- autenticação obrigatória;
- sessão do cliente em `sessionStorage`;
- empresa resolvida a partir da sessão;
- campo de empresa bloqueado;
- filtros desabilitados;
- acesso administrativo oculto;
- shutdown oculto.

Arquivos principais:

- [config.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/core/config.js)
- [auth.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/core/auth.js)
- [client-mode.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/main-folder/client-mode.js)

## Rotas e páginas principais

### Login

- `/login`
  Tela única de autenticação.

Detalhe importante:

- o login primeiro tenta autenticar como ADM;
- se não passar, tenta autenticar como cliente;
- a mesma tela atende os dois cenários.

Arquivos:

- [index.html](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/pages/login/index.html)
- [client-login.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/pages/client-login.js)

### Obras do cliente

- `/obras/create`

Uso:

- ambiente restrito para clientes autenticados;
- empresa herdada da sessão;
- mesma base funcional do módulo de obras, com restrições de UI.

Arquivo:

- [create.html](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/pages/obras/create.html)

### Obras administrativas

- `/admin/obras/create`

Uso:

- tela principal de criação, edição e atualização de obras no modo interno;
- permite preencher dados completos da empresa e credenciais de acesso.

Arquivo:

- [create.html](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/pages/admin/obras/create.html)

### Obras em modo embed

- `/admin/obras/embed`

Uso:

- variante embutida para visualização/integração;
- filtros e navegação administrativa ocultos.

Arquivo:

- [embed.html](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/pages/admin/obras/embed.html)

### Painel de dados administrativos

- `/admin/data`

Uso:

- manutenção dos bancos do sistema;
- gestão de empresas, credenciais, SMTP e catálogos.

Arquivo:

- [index.html](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/pages/admin/data/index.html)

## O que o sistema faz

### Cadastro estrutural

- cria obras;
- cria projetos dentro da obra;
- cria salas dentro de cada projeto;
- mantém identificadores derivados de empresa e número do cliente;
- sincroniza cabeçalho e metadados da obra após salvamento.

### Cálculo técnico

- vazão de ar externo;
- ganhos térmicos;
- pressurização;
- capacidade de refrigeração;
- solução de máquinas;
- ventilação;
- componentes associados.

### Catálogos de apoio

- máquinas;
- materiais;
- acessórios;
- dutos;
- tubos;
- constantes do sistema.

### Exportação

- proposta técnica;
- proposta comercial;
- ambos;
- download;
- envio por email;
- fluxo combinado de download + email.

## Credenciais e empresas

O sistema hoje trata credenciais de empresa como parte do cadastro da empresa, mas também permite preenchê-las a partir da obra no ambiente administrativo.

### Campos de credencial de empresa

- usuário de acesso;
- email de recuperação;
- token de acesso;
- tempo de uso;
- data de criação;
- data de expiração.

### Fluxo atual de sincronização

#### Obra para empresa

Quando a obra é salva ou atualizada:

- os dados da empresa são extraídos do formulário;
- `empresaCredenciais` segue no payload da obra quando houver token;
- o backend faz `upsert` das credenciais no cadastro da empresa.

Arquivos centrais:

- [empresa-data-extractor.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/data/empresa-system/empresa-data-extractor.js)
- [obra-save-handler.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/features/managers/obra-folder/obra-save-handler.js)
- [routes_core.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/core/routes_core.py)
- [empresa_repository.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/database/repositories/empresa_repository.py)

#### Empresa para obra

No ambiente administrativo:

- ao selecionar empresa na obra, o formulário tenta preencher as credenciais já cadastradas;
- se não existir credencial salva, os campos ficam vazios para criação manual;
- ao editar credenciais no grid de empresas, os blocos de obra renderizados para a mesma empresa são atualizados localmente.

Arquivos centrais:

- [empresa-form-manager.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/data/empresa-system/empresa-form-manager.js)
- [empresa-ui-helpers.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/data/empresa-system/empresa-ui-helpers.js)
- [empresas.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/03_Edit_data/core/empresas.js)

### Regras importantes

- limpar a empresa limpa também email, usuário e token no formulário administrativo;
- o sistema não deve fabricar credencial automaticamente só por trocar empresa;
- token novo nasce apenas por ação explícita do usuário;
- o email da empresa também alimenta o fluxo de recuperação de token e exportação;
- o cliente só autentica se o token estiver válido e não expirado.

## Credenciais ADM, email e entrega

O painel administrativo possui uma aba especifica para:

- credenciais de administradores;
- email de recuperação dos administradores;
- configuracao do remetente do sistema.

Essa configuracao e usada em:

- exportação por email;
- recuperação de token por email;
- notificações automáticas ao ADM.

Implementacao atual do backend:

- a configuracao do remetente fica persistida na tabela `admin_email_config`;
- se existir `json/admin_email_config.json`, o backend migra o arquivo legado para o banco ao carregar;
- o envio tenta primeiro o provedor HTTP Resend quando `RESEND_API`, `RESEND_API_KEY` ou `resend_API` estiver configurado;
- se o Resend nao estiver disponivel ou falhar, o backend tenta SMTP;
- o host SMTP pode vir de `ESI_SMTP_HOST`, `ESI_SMTP_PORT` e `ESI_SMTP_USE_TLS`, da configuracao salva no painel ou ser inferido pelo dominio do remetente;
- Gmail exige App Password de 16 caracteres em vez do token interno do sistema.

Arquivos:

- [admin-credentials.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/03_Edit_data/core/admin-credentials.js)
- [admin-credentials.css](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/static/03_Edit_data/admin-credentials.css)

Endpoints:

- `GET /api/admin/email-config`
- `POST /api/admin/email-config`

## Recuperação de token por email

A tela de login oferece recuperação de token.

Fluxo:

1. usuário informa usuário + email de recuperação;
2. backend procura correspondência em ADM e empresas;
3. se encontrar uma conta única compatível, envia o token atual por email.

Endpoint:

- `POST /api/auth/recover-token`

Observações:

- depende de email do ADM configurado;
- depende de email cadastrado corretamente;
- se houver ambiguidade, o backend bloqueia o envio.

## Exportação de documentos e envio por email

O sistema possui dois fluxos de exportação.

### 1. Geração Word clássica

Usa os geradores de documento para PT, PC ou ambos.

Rotas:

- `GET /api/word/models`
- `GET /api/word/templates`
- `POST /api/word/generate/proposta-comercial`
- `POST /api/word/generate/proposta-tecnica`
- `POST /api/word/generate/ambos`
- `GET /api/word/download?id=...`

### 2. Exportação unificada

Fluxo mais novo orientado a download, email ou ambos.

Endpoint:

- `POST /api/export`

Modos:

- `download`
- `email`
- `completo`

Formatos:

- `pc`
- `pt`
- `ambos`

Comportamento:

- monta os arquivos temporários da obra;
- opcionalmente registra downloads para retirada posterior;
- opcionalmente envia anexos por email;
- trabalha com jobs assíncronos de background.
- quando ha chave Resend valida, o envio pode ocorrer por HTTP antes do fallback SMTP;
- os anexos podem ser preparados em ZIP temporario para preservar integridade no envio.

Arquivos:

- [export-modal.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/ui/download/export-modal.js)
- [word-modal.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/ui/download/word-modal.js)
- [http_handler.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/handlers/http_handler.py)
- [wordPT_generator.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/generators/wordPT_generator.py)
- [wordPC_generator.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/generators/wordPC_generator.py)

### Notificação automática ao ADM

Quando uma obra é salva no modo cliente:

- o frontend chama `/api/obra/notificar`;
- o backend pode gerar os anexos;
- o envio usa o remetente SMTP cadastrado.

Arquivo:

- [obra-save-handler.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/features/managers/obra-folder/obra-save-handler.js)

## Arquitetura do repositório

```text
.
├─ README.md
├─ requirements.txt
├─ setup.py
├─ codigo/
│  ├─ servidor.py
│  ├─ database/
│  │  └─ app.sqlite3
│  ├─ json/
│  ├─ public/
│  │  ├─ pages/
│  │  ├─ scripts/
│  │  ├─ static/
│  │  └─ images/
│  ├─ servidor_modules/
│  │  ├─ core/
│  │  ├─ database/
│  │  ├─ generators/
│  │  ├─ handlers/
│  │  └─ utils/
│  └─ word_templates/
└─ utilitarios py/
```

### Frontend principal

Raiz:

- [01_Create_Obra](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra)

Pastas:

- `core/`
  configuração, autenticação, bootstrap e utilitários compartilhados.
- `data/`
  builders, extração de dados, adapters e sistema de empresa.
- `features/`
  managers e cálculos.
- `main-folder/`
  inicialização da aplicação e modo cliente.
- `pages/`
  scripts de entrada das páginas.
- `ui/`
  componentes visuais, status, modal e exportação.

### Painel administrativo

Raiz:

- [03_Edit_data](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/03_Edit_data)

Responsabilidades:

- carregar `systemData`;
- editar bancos estruturais;
- controlar pendências de salvamento;
- renderizar tabs administrativas;
- persistir alterações do painel.

### Backend

Arquivos centrais:

- [servidor.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor.py)
- [server_core.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/core/server_core.py)
- [http_handler.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/handlers/http_handler.py)
- [routes_core.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/core/routes_core.py)

Responsabilidades:

- servir HTML, JS, CSS e assets;
- expor APIs JSON;
- autenticar cliente e ADM;
- persistir dados;
- gerar documentos Word;
- enviar emails;
- coordenar exportações assíncronas.

## Persistência de dados

O sistema hoje e hibrido, mas com hierarquia clara entre online e offline.

### Banco online principal

Banco principal de producao:

- PostgreSQL acessado por `DATABASE_URL`
- conexao com `sslmode=require`
- pool gerenciado por `psycopg_pool`
- inicializacao automatica do schema na primeira conexao

Arquivos:

- [connection.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/database/connection.py)
- [storage.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/database/storage.py)

### Snapshot offline local

Arquivos locais usados fora do ambiente Render:

- [app.sqlite3](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/database/app.sqlite3)
- [app-offline-backup.sql](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/database/app-offline-backup.sql)
- [sync-base.json](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/database/sync-base.json)
- [sync-metadata.json](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/database/sync-metadata.json)

Uso:

- manter um espelho local controlado do banco online;
- permitir importacao online -> offline;
- permitir exportacao offline -> online quando o baseline estiver alinhado;
- registrar digests, conflitos e ultima direcao de sincronizacao.

Schema central:

- `admins`
- `empresas`
- `obras`
- `projetos`
- `salas`
- `sala_maquinas`
- `materials`
- `machine_catalog`
- `acessorios`
- `dutos`
- `tubos`
- `sessions`
- `admin_email_config`
- `obra_notifications`

### JSON

O projeto ainda mantém documentos JSON e camadas de compatibilidade para:

- dados agregados;
- backup;
- sessões;
- migração/convivência com estrutura legada.

Diretório:

- [json](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/json)

## Sync online e offline

O banco online e a fonte primaria. O SQLite local funciona como snapshot sincronizado e nao como banco mestre permanente.

Arquivos e artefatos principais:

- `database/app.sqlite3`: snapshot local consultavel;
- `database/app-offline-backup.sql`: dump SQL do snapshot local;
- `database/sync-base.json`: baseline confiavel da ultima sincronizacao alinhada;
- `database/sync-metadata.json`: status, digests, conflitos e historico da reconciliacao.

Comportamento operacional:

- no startup local, o backend aquece a conexao PostgreSQL e tenta reconciliar o snapshot local automaticamente;
- no Render, as rotas e rotinas de snapshot offline local ficam desabilitadas;
- importacao online -> offline sobrescreve o snapshot local apenas quando nao ha alteracoes locais fora do baseline;
- exportacao offline -> online so acontece quando o online ainda corresponde ao baseline anterior, evitando sobrescrever alteracoes remotas;
- a reconciliacao pode alinhar os lados automaticamente quando nao existe conflito destrutivo;
- apos salvamentos online, o backend pode atualizar o snapshot local em background.

Endpoints do fluxo offline:

- `POST /api/system/offline/import`
- `POST /api/system/offline/export`
- `POST /api/system/offline/reconcile`
- `POST /api/system/offline/background-save`

Implementacao central:

- [routes_core.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/core/routes_core.py)
- [route_handler.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/handlers/route_handler.py)
- [connection.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/database/connection.py)

## Bootstrap e carregamento de dados

O frontend usa payloads de bootstrap para evitar múltiplas consultas fragmentadas.

Endpoints principais:

- `GET /api/runtime/bootstrap`
- `GET /api/runtime/system-bootstrap`

Uso:

- carregar obras visíveis;
- carregar catálogos e bancos administrativos;
- preencher contexto de empresa;
- alimentar autocomplete, filtros e grids.

Arquivo:

- [system-bootstrap.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/core/system-bootstrap.js)

## Como executar

### Requisitos

- Python 3.x
- dependências de [requirements.txt](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/requirements.txt)

Dependências principais:

- Flask
- pandas
- numpy
- openpyxl
- psycopg[binary,pool]
- python-docx
- docxtpl
- Jinja2
- Pillow
- lxml

### Instalação

```bash
pip install -r requirements.txt
```

### Execução local

```bash
python codigo/servidor.py
```

Comportamento esperado:

- o servidor procura a porta `8000`;
- se necessário, tenta liberar a porta ou escolher outra;
- abre o navegador automaticamente em `/admin/obras/create`.

### Geração do executável

O executável Windows é gerado a partir dos arquivos-fonte do projeto. O diretório `dist/` é apenas saída de build e não deve ser editado manualmente.

Comando:

```bash
python setup.py build_exe
```

Fluxo recomendado:

1. altere apenas os arquivos originais em `codigo/`, `setup.py`, `assets/` e templates;
2. execute `python setup.py build_exe`;
3. envie ao cliente a pasta gerada em `dist/ESI-Energia`.

Regras importantes:

- não edite arquivos dentro de `dist/`;
- sempre gere novamente o build depois de mudar o código-fonte;
- para distribuição, envie a pasta `dist/ESI-Energia` completa ou um `.zip` dessa pasta, não apenas o `.exe` isolado.

## Operação diária recomendada

### Para criar obras internas

1. abra `/admin/obras/create`;
2. selecione a empresa;
3. preencha projeto, salas e dados técnicos;
4. se necessário, preencha credenciais da empresa;
5. salve a obra;
6. exporte PT/PC por download ou email.

### Para configurar email do sistema

1. abra `/admin/data`;
2. vá para `Credenciais ADM`;
3. preencha email, token SMTP e nome do remetente;
4. salve;
5. valide a exportação por email.

### Para gerenciar acesso do cliente

1. abra `/admin/data`;
2. vá para `Empresas`;
3. crie ou atualize usuário, email e token;
4. defina validade;
5. salve o painel administrativo.

## Pontos importantes do comportamento atual

- o login de cliente e de ADM compartilha a mesma tela;
- o modo cliente restringe empresa, filtros e navegação administrativa;
- a obra administrativa consegue criar credenciais da empresa sem sair da tela;
- o grid de empresas também consegue criar e editar credenciais;
- a sincronização empresa ↔ obra depende do salvamento do fluxo correspondente;
- a persistencia principal esta no PostgreSQL online;
- o SQLite local e um snapshot sincronizado para operacao offline e contingencia;
- exportacao por email depende de email do ADM configurado, com tentativa via Resend e fallback SMTP;
- recuperação de token depende de email de recuperação válido;
- tokens podem ter validade e expiração;
- há limpeza e saneamento de credenciais expiradas em fluxos do backend.

## Arquivos mais críticos do sistema

- [servidor.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor.py)
- [http_handler.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/handlers/http_handler.py)
- [routes_core.py](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/servidor_modules/core/routes_core.py)
- [empresa-form-manager.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/data/empresa-system/empresa-form-manager.js)
- [empresa-data-extractor.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/data/empresa-system/empresa-data-extractor.js)
- [empresas.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/03_Edit_data/core/empresas.js)
- [admin-credentials.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/03_Edit_data/core/admin-credentials.js)
- [obra-save-handler.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/features/managers/obra-folder/obra-save-handler.js)
- [export-modal.js](/c:/Users/vitor/OneDrive/Repositórios/app.esienergia/codigo/public/scripts/01_Create_Obra/ui/download/export-modal.js)

## Resumo executivo

Este sistema não é apenas um formulário de obras. Ele reúne, no mesmo produto:

- CRM técnico de empresas e obras;
- cálculo de climatização e ventilação;
- catálogo editável de máquinas e componentes;
- autenticação por empresa;
- recuperação de token;
- exportação documental;
- entrega por email;
- painel administrativo de manutenção de dados.

Se o próximo passo for melhorar a documentação ainda mais, o ideal é quebrar este README em documentos menores por domínio:

- `docs/arquitetura.md`
- `docs/fluxo-de-credenciais.md`
- `docs/exportacao-email.md`
- `docs/modo-cliente.md`
- `docs/backend-e-apis.md`
