# Render Deployment Manager - Guia Completo

## 📋 Sumário

- [Visão Geral](#visão-geral)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Recursos da API](#recursos-da-api)
- [Uso via CLI](#uso-via-cli)
- [Uso Programático](#uso-programático)
- [Monitoramento em Tempo Real](#monitoramento-em-tempo-real)
- [Exemplos Avançados](#exemplos-avançados)
- [Troubleshooting](#troubleshooting)

## 🎯 Visão Geral

O **Render Deployment Manager** é um sistema completo de gerenciamento e monitoramento para a plataforma Render. Ele oferece:

- ✅ **Monitoramento em tempo real** de deployments
- ✅ **Automação completa** de CI/CD
- ✅ **Gerenciamento de serviços** (criar, atualizar, suspender, deletar)
- ✅ **Controle de deploys** (trigger, rollback, cancelar)
- ✅ **Streaming de logs** em tempo real
- ✅ **Relatórios detalhados** de performance
- ✅ **Gerenciamento de ambiente** e variáveis
- ✅ **Métricas e estatísticas** de deployments
- ✅ **Alertas e notificações** customizáveis
- ✅ **Suporte a todos os recursos** da API Render v1

### Recursos da API Render Suportados

O manager implementa todos os principais endpoints:

#### Services
- `GET /services` - Listar serviços
- `POST /services` - Criar serviço
- `GET /services/{id}` - Detalhes do serviço
- `PATCH /services/{id}` - Atualizar serviço
- `DELETE /services/{id}` - Deletar serviço
- `POST /services/{id}/suspend` - Suspender serviço
- `POST /services/{id}/resume` - Retomar serviço
- `POST /services/{id}/restart` - Reiniciar serviço
- `POST /services/{id}/scale` - Escalar serviço

#### Deploys
- `GET /services/{id}/deploys` - Listar deploys
- `POST /services/{id}/deploys` - Trigger deploy
- `GET /services/{id}/deploys/{deployId}` - Detalhes do deploy
- `POST /services/{id}/deploys/{deployId}/cancel` - Cancelar deploy
- `POST /services/{id}/rollback` - Rollback de deploy

#### Logs
- `GET /logs` - Consultar logs
- `GET /logs/subscribe` - Stream de logs via WebSocket
- `GET /logs/values` - Valores disponíveis para filtros

#### Environment Variables
- `GET /services/{id}/env-vars` - Listar variáveis
- `PUT /services/{id}/env-vars` - Atualizar todas
- `GET /services/{id}/env-vars/{key}` - Obter variável
- `PUT /services/{id}/env-vars/{key}` - Atualizar variável
- `DELETE /services/{id}/env-vars/{key}` - Deletar variável

#### Events
- `GET /services/{id}/events` - Eventos do serviço
- `GET /events/{id}` - Detalhes do evento

#### Workspaces
- `GET /owners` - Listar workspaces
- `GET /owners/{id}` - Detalhes do workspace
- `GET /owners/{id}/members` - Membros do workspace

#### Postgres
- `GET /postgres` - Listar bancos
- `POST /postgres` - Criar banco
- `GET /postgres/{id}/connection-info` - Info de conexão
- `POST /postgres/{id}/suspend` - Suspender
- `POST /postgres/{id}/resume` - Retomar

#### Redis/Key-Value
- `GET /key-value` - Listar instâncias
- `POST /key-value` - Criar instância
- `GET /key-value/{id}/connection-info` - Info de conexão

#### Blueprints
- `GET /blueprints` - Listar blueprints
- `POST /blueprints/validate` - Validar blueprint
- `PATCH /blueprints/{id}` - Atualizar blueprint

#### Metrics
- `GET /metrics/cpu` - Métricas de CPU
- `GET /metrics/memory` - Métricas de memória
- `GET /metrics/bandwidth` - Métricas de banda
- `GET /metrics/http-requests` - Métricas de requests

## 🚀 Instalação

### 1. Instalar dependências

```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector
pip install -r scripts/requirements-render.txt
```

### 2. Configurar API Key

Obtenha sua API key no Render Dashboard:
1. Acesse https://dashboard.render.com/
2. Vá em Account Settings → API Keys
3. Crie uma nova API key

Configure a variável de ambiente:

```bash
# Linux/macOS
export RENDER_API_KEY="rnd_your_api_key_here"

# Windows (PowerShell)
$env:RENDER_API_KEY="rnd_your_api_key_here"

# Ou adicione ao .env
echo "RENDER_API_KEY=rnd_your_api_key_here" >> concierge-api-v3/.env
```

### 3. Tornar o script executável

```bash
chmod +x scripts/render_deployment_manager.py
```

## 📖 Uso via CLI

### Listar Serviços

```bash
# Listar todos os serviços
python scripts/render_deployment_manager.py list-services

# Filtrar por workspace
python scripts/render_deployment_manager.py list-services --owner-id tea-xxxxx

# Filtrar por tipo
python scripts/render_deployment_manager.py list-services --type web_service
```

### Listar Deploys

```bash
# Listar últimos 10 deploys de um serviço
python scripts/render_deployment_manager.py list-deploys srv-xxxxx

# Listar mais deploys
python scripts/render_deployment_manager.py list-deploys srv-xxxxx --limit 50
```

### Monitorar Deployments em Tempo Real

```bash
# Monitorar um serviço específico
python scripts/render_deployment_manager.py monitor srv-xxxxx

# Monitorar com intervalo customizado (30 segundos)
python scripts/render_deployment_manager.py monitor srv-xxxxx --interval 30

# Monitorar por tempo limitado (5 minutos)
python scripts/render_deployment_manager.py monitor srv-xxxxx --duration 300

# Monitorar todos os serviços
python scripts/render_deployment_manager.py monitor-all

# Monitorar todos de um workspace
python scripts/render_deployment_manager.py monitor-all --owner-id tea-xxxxx
```

### Trigger Manual de Deploy

```bash
# Deploy normal
python scripts/render_deployment_manager.py deploy srv-xxxxx

# Deploy limpando cache
python scripts/render_deployment_manager.py deploy srv-xxxxx --clear-cache

# Deploy de commit específico
python scripts/render_deployment_manager.py deploy srv-xxxxx --commit abc123def456
```

### Rollback

```bash
# Fazer rollback para deploy anterior
python scripts/render_deployment_manager.py rollback srv-xxxxx dep-xxxxx
```

### Gerar Relatório

```bash
# Relatório dos últimos 7 dias
python scripts/render_deployment_manager.py report srv-xxxxx

# Relatório dos últimos 30 dias
python scripts/render_deployment_manager.py report srv-xxxxx --days 30
```

### Obter Logs

```bash
# Logs da última hora
python scripts/render_deployment_manager.py logs tea-xxxxx srv-xxxxx

# Logs das últimas 6 horas
python scripts/render_deployment_manager.py logs tea-xxxxx srv-xxxxx --hours 6

# Logs de múltiplos recursos
python scripts/render_deployment_manager.py logs tea-xxxxx srv-xxxxx srv-yyyyy job-zzzzz
```

## 💻 Uso Programático

### Exemplo Básico

```python
from scripts.render_deployment_manager import RenderAPI
import os

# Inicializar cliente
api = RenderAPI(os.getenv('RENDER_API_KEY'))

# Listar serviços
services = api.list_services()
for service in services:
    print(f"{service.name} ({service.type})")

# Obter detalhes de serviço
service = api.get_service('srv-xxxxx')
print(f"Branch: {service.branch}")
print(f"Auto-deploy: {service.auto_deploy}")

# Listar deploys
deploys = api.list_deploys('srv-xxxxx', limit=5)
for deploy in deploys:
    print(f"{deploy.id}: {deploy.status}")

# Trigger deploy
new_deploy = api.trigger_deploy('srv-xxxxx', clear_cache=True)
print(f"Deploy {new_deploy.id} criado")
```

### Monitoramento Customizado

```python
from scripts.render_deployment_manager import RenderAPI, DeploymentMonitor
import os

api = RenderAPI(os.getenv('RENDER_API_KEY'))
monitor = DeploymentMonitor(api, poll_interval=30)

# Definir callbacks customizados
def on_deploy_start(deploy):
    print(f"🚀 Deploy iniciado: {deploy.id}")
    # Enviar notificação Slack, Discord, etc
    send_slack_notification(f"Deploy iniciado em {deploy.service_id}")

def on_deploy_complete(deploy):
    print(f"✓ Deploy concluído: {deploy.id}")
    # Executar testes de smoke
    run_smoke_tests(deploy.service_id)
    # Notificar sucesso
    send_success_notification(deploy)

def on_deploy_fail(deploy):
    print(f"✗ Deploy falhou: {deploy.id}")
    # Fazer rollback automático
    api.rollback_deploy(deploy.service_id, get_last_good_deploy(deploy.service_id))
    # Alertar equipe
    send_alert_to_team(deploy)

def on_status_change(old_deploy, new_deploy):
    print(f"Status mudou: {old_deploy.status} → {new_deploy.status}")
    # Log detalhado
    log_status_change(old_deploy, new_deploy)

# Registrar callbacks
monitor.register_callback('on_deploy_start', on_deploy_start)
monitor.register_callback('on_deploy_complete', on_deploy_complete)
monitor.register_callback('on_deploy_fail', on_deploy_fail)
monitor.register_callback('on_status_change', on_status_change)

# Iniciar monitoramento
monitor.monitor_service('srv-xxxxx')
```

### Gerenciamento de Variáveis de Ambiente

```python
from scripts.render_deployment_manager import RenderAPI
import os

api = RenderAPI(os.getenv('RENDER_API_KEY'))
service_id = 'srv-xxxxx'

# Listar variáveis
env_vars = api.list_env_vars(service_id)
for var in env_vars:
    print(f"{var['key']}: {var['value']}")

# Atualizar variável
api.update_env_var(service_id, 'DATABASE_URL', 'postgres://...')
api.update_env_var(service_id, 'DEBUG_MODE', 'false')

# Trigger deploy para aplicar mudanças
api.trigger_deploy(service_id)
```

### Relatórios Automatizados

```python
from scripts.render_deployment_manager import RenderAPI, DeploymentReporter
import os
import json

api = RenderAPI(os.getenv('RENDER_API_KEY'))
reporter = DeploymentReporter(api)

# Gerar relatório
report = reporter.generate_service_report('srv-xxxxx', days=30)

# Salvar em JSON
with open('deployment_report.json', 'w') as f:
    json.dump(report, f, indent=2)

# Imprimir no terminal
reporter.print_report(report)

# Enviar por email
send_email_report(report)

# Postar no Slack
post_to_slack(report)
```

## 🔔 Monitoramento em Tempo Real

### Sistema de Callbacks

O sistema de callbacks permite reagir a eventos em tempo real:

```python
from scripts.render_deployment_manager import DeploymentMonitor, RenderAPI
import os

api = RenderAPI(os.getenv('RENDER_API_KEY'))
monitor = DeploymentMonitor(api, poll_interval=20)

# Callback complexo com múltiplas ações
def handle_deploy_failure(deploy):
    # 1. Log detalhado
    logger.error(f"Deploy failed: {deploy.id}")
    
    # 2. Obter logs do deploy
    logs = api.get_logs(
        owner_id='tea-xxxxx',
        resource_ids=[deploy.service_id],
        start_time=int(deploy.created_at.timestamp()),
        end_time=int(datetime.now().timestamp())
    )
    
    # 3. Analisar erro
    error_logs = [log for log in logs if 'error' in log.lower()]
    
    # 4. Decidir ação
    if should_auto_rollback(error_logs):
        # Rollback automático
        last_good = get_last_successful_deploy(deploy.service_id)
        api.rollback_deploy(deploy.service_id, last_good.id)
    
    # 5. Notificar equipe
    send_pagerduty_alert({
        'service': deploy.service_id,
        'deploy': deploy.id,
        'error_logs': error_logs[:5]
    })

monitor.register_callback('on_deploy_fail', handle_deploy_failure)
monitor.monitor_service('srv-xxxxx')
```

### Monitoramento Multi-Serviço

```python
from scripts.render_deployment_manager import RenderAPI, DeploymentMonitor
from threading import Thread
import os

api = RenderAPI(os.getenv('RENDER_API_KEY'))

# Obter todos os serviços de produção
services = api.list_services()
prod_services = [s for s in services if 'prod' in s.name.lower()]

# Criar monitor para cada serviço
monitors = []
for service in prod_services:
    monitor = DeploymentMonitor(api, poll_interval=30)
    
    # Callbacks específicos por serviço
    def create_callbacks(svc):
        def on_fail(deploy):
            print(f"❌ {svc.name} deploy failed!")
            send_alert(svc.name, deploy)
        return on_fail
    
    monitor.register_callback('on_deploy_fail', create_callbacks(service))
    
    # Iniciar em thread separada
    thread = Thread(target=monitor.monitor_service, args=(service.id,))
    thread.daemon = True
    thread.start()
    
    monitors.append((service, monitor, thread))

print(f"Monitorando {len(monitors)} serviços...")
# Manter rodando
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("Encerrando monitoramento...")
```

## 🎓 Exemplos Avançados

### Pipeline CI/CD Completo

```python
#!/usr/bin/env python3
"""
Pipeline CI/CD automatizado usando Render Deployment Manager
"""
from scripts.render_deployment_manager import RenderAPI, DeploymentMonitor
import os
import time

class CICDPipeline:
    def __init__(self, api_key: str):
        self.api = RenderAPI(api_key)
        self.monitor = DeploymentMonitor(self.api, poll_interval=15)
        
    def deploy_with_validation(self, service_id: str, commit_sha: str):
        """Deploy com validação completa"""
        print("=" * 80)
        print(f"INICIANDO PIPELINE DE DEPLOY")
        print("=" * 80)
        
        # 1. Validar serviço
        print("\n[1/6] Validando serviço...")
        service = self.api.get_service(service_id)
        print(f"✓ Serviço: {service.name}")
        print(f"  Tipo: {service.type}")
        print(f"  Branch: {service.branch}")
        
        # 2. Verificar último deploy
        print("\n[2/6] Verificando último deploy...")
        deploys = self.api.list_deploys(service_id, limit=1)
        if deploys:
            last_deploy = deploys[0]
            print(f"✓ Último deploy: {last_deploy.status}")
            if last_deploy.status not in ['live', 'deactivated']:
                print("⚠ Deploy em progresso. Aguardando conclusão...")
                self.wait_for_deploy(service_id, last_deploy.id)
        
        # 3. Backup de variáveis de ambiente
        print("\n[3/6] Backup de configurações...")
        env_vars = self.api.list_env_vars(service_id)
        with open(f'backup_env_{service_id}.json', 'w') as f:
            json.dump(env_vars, f)
        print(f"✓ {len(env_vars)} variáveis salvas")
        
        # 4. Trigger deploy
        print(f"\n[4/6] Iniciando deploy do commit {commit_sha[:8]}...")
        new_deploy = self.api.trigger_deploy(
            service_id,
            commit_id=commit_sha,
            clear_cache=False
        )
        print(f"✓ Deploy {new_deploy.id} criado")
        
        # 5. Monitorar deploy
        print("\n[5/6] Monitorando deploy...")
        success = self.monitor_deploy_progress(service_id, new_deploy.id)
        
        # 6. Validação pós-deploy
        if success:
            print("\n[6/6] Executando testes pós-deploy...")
            if self.run_smoke_tests(service_id):
                print("\n" + "=" * 80)
                print("✅ DEPLOY CONCLUÍDO COM SUCESSO")
                print("=" * 80)
                return True
            else:
                print("\n⚠ Testes falharam. Iniciando rollback...")
                self.rollback_to_previous(service_id)
                return False
        else:
            print("\n" + "=" * 80)
            print("❌ DEPLOY FALHOU")
            print("=" * 80)
            return False
    
    def wait_for_deploy(self, service_id: str, deploy_id: str, timeout: int = 1800):
        """Aguarda conclusão de deploy"""
        start = time.time()
        while time.time() - start < timeout:
            deploy = self.api.get_deploy(service_id, deploy_id)
            if deploy.status in ['live', 'deactivated', 'build_failed', 
                                'update_failed', 'canceled']:
                return deploy.status == 'live'
            time.sleep(10)
        return False
    
    def monitor_deploy_progress(self, service_id: str, deploy_id: str):
        """Monitora progresso do deploy com feedback visual"""
        stages = {
            'created': '📦',
            'build_in_progress': '🔨',
            'pre_deploy_in_progress': '🚀',
            'update_in_progress': '⚙️',
            'live': '✅',
            'build_failed': '❌',
            'update_failed': '❌'
        }
        
        last_status = None
        while True:
            deploy = self.api.get_deploy(service_id, deploy_id)
            
            if deploy.status != last_status:
                icon = stages.get(deploy.status, '❓')
                print(f"{icon} Status: {deploy.status}")
                last_status = deploy.status
            
            # Deploy finalizado
            if deploy.status == 'live':
                return True
            elif 'failed' in deploy.status or deploy.status == 'canceled':
                return False
            
            time.sleep(15)
    
    def run_smoke_tests(self, service_id: str) -> bool:
        """Executa testes básicos de smoke"""
        service = self.api.get_service(service_id)
        
        # Teste 1: Serviço responde
        print("  → Verificando disponibilidade...")
        # Implementar verificação HTTP
        
        # Teste 2: Health check
        print("  → Executando health check...")
        # Implementar health check
        
        # Teste 3: Verificar logs
        print("  → Analisando logs...")
        logs = self.api.get_logs(
            service.owner_id,
            [service_id],
            limit=50
        )
        
        # Procurar por erros
        error_logs = [log for log in logs.get('logs', []) 
                     if 'error' in log.get('text', '').lower()]
        
        if error_logs:
            print(f"  ⚠ {len(error_logs)} erros encontrados nos logs")
            return False
        
        print("  ✓ Todos os testes passaram")
        return True
    
    def rollback_to_previous(self, service_id: str):
        """Rollback para deploy anterior bem-sucedido"""
        deploys = self.api.list_deploys(service_id, limit=10)
        last_good = None
        
        for deploy in deploys[1:]:  # Pula o atual
            if deploy.status == 'live':
                last_good = deploy
                break
        
        if last_good:
            print(f"Revertendo para deploy {last_good.id}...")
            rollback_deploy = self.api.rollback_deploy(service_id, last_good.id)
            self.wait_for_deploy(service_id, rollback_deploy.id)
            print("✓ Rollback concluído")
        else:
            print("❌ Nenhum deploy anterior encontrado")

# Uso
if __name__ == '__main__':
    pipeline = CICDPipeline(os.getenv('RENDER_API_KEY'))
    
    # Deploy automático
    success = pipeline.deploy_with_validation(
        service_id='srv-xxxxx',
        commit_sha='abc123def456'
    )
    
    sys.exit(0 if success else 1)
```

### Dashboard de Monitoramento

```python
#!/usr/bin/env python3
"""
Dashboard de monitoramento em tempo real
Requer: rich
"""
from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.layout import Layout
from scripts.render_deployment_manager import RenderAPI, DeploymentMonitor
import os
import time

class DeploymentDashboard:
    def __init__(self, api_key: str):
        self.api = RenderAPI(api_key)
        self.console = Console()
        self.services_status = {}
        
    def create_dashboard(self):
        """Cria layout do dashboard"""
        layout = Layout()
        
        layout.split_column(
            Layout(name="header", size=3),
            Layout(name="body"),
            Layout(name="footer", size=3)
        )
        
        return layout
    
    def generate_table(self):
        """Gera tabela de serviços"""
        table = Table(title="Render Services Status", show_header=True)
        
        table.add_column("Service", style="cyan")
        table.add_column("Type", style="magenta")
        table.add_column("Status", style="green")
        table.add_column("Last Deploy", style="yellow")
        table.add_column("Auto Deploy", style="blue")
        
        services = self.api.list_services()
        
        for service in services[:10]:  # Limita a 10
            # Obter último deploy
            deploys = self.api.list_deploys(service.id, limit=1)
            last_deploy_status = deploys[0].status if deploys else "N/A"
            
            # Status colorido
            status_color = "green" if service.suspended == "not_suspended" else "red"
            status_icon = "🟢" if service.suspended == "not_suspended" else "🔴"
            
            table.add_row(
                service.name,
                service.type,
                f"{status_icon} {service.suspended}",
                last_deploy_status,
                service.auto_deploy
            )
        
        return table
    
    def run(self):
        """Executa dashboard"""
        with Live(self.generate_table(), refresh_per_second=0.5) as live:
            while True:
                time.sleep(10)
                live.update(self.generate_table())

# Uso
if __name__ == '__main__':
    dashboard = DeploymentDashboard(os.getenv('RENDER_API_KEY'))
    dashboard.run()
```

## 🔧 Troubleshooting

### Erro: "RENDER_API_KEY não configurada"

**Solução:**
```bash
export RENDER_API_KEY="rnd_your_key_here"
# ou
echo "RENDER_API_KEY=rnd_your_key_here" >> concierge-api-v3/.env
```

### Erro: "401 Unauthorized"

**Causas possíveis:**
- API key inválida ou expirada
- API key sem permissões adequadas

**Solução:**
1. Verifique se a API key está correta
2. Regenere a API key no Render Dashboard
3. Verifique se a API key tem permissões de leitura/escrita

### Erro: "429 Rate Limit"

A API Render tem limites de taxa. 

**Solução:**
- Aumente o `poll_interval` no monitor (padrão: 30s)
- Implemente exponential backoff
- Use webhooks ao invés de polling

### Erro: "Service não encontrado"

**Solução:**
- Verifique o ID do serviço (começa com `srv-`)
- Liste serviços para confirmar o ID correto:
  ```bash
  python scripts/render_deployment_manager.py list-services
  ```

## 📚 Referências

- [Render API Documentation](https://api-docs.render.com/)
- [Render Dashboard](https://dashboard.render.com/)
- [OpenAPI Specification](../concierge-api-v3/docs/openapi-render.json)

## 🤝 Contribuindo

Para adicionar novos recursos:

1. Implemente o método na classe `RenderAPI`
2. Adicione comando CLI correspondente em `main()`
3. Documente no guia
4. Adicione testes

## 📝 Licença

Este projeto segue a mesma licença do projeto Concierge-Collector.
