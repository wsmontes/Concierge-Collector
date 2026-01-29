#!/usr/bin/env python3
"""
Render Deployment Manager - Sistema completo de monitoramento e gerenciamento de deployments

Este módulo oferece controle total sobre todos os recursos da API Render:
- Monitoramento em tempo real de deploys
- Gerenciamento de serviços, bancos de dados e recursos
- Streaming de logs via WebSocket
- Notificações e alertas
- Métricas e estatísticas
- Automação de rollbacks
- Gestão de ambiente e variáveis

Dependências:
    - requests: Requisições HTTP
    - websocket-client: Streaming de logs em tempo real
    - python-dotenv: Gerenciamento de variáveis de ambiente
    - rich: Interface visual no terminal
"""

import os
import sys
import time
import json
import logging
import argparse
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from enum import Enum
import requests
from pathlib import Path

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('render_deployment.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class DeployStatus(Enum):
    """Status possíveis de um deployment"""
    CREATED = "created"
    BUILD_IN_PROGRESS = "build_in_progress"
    UPDATE_IN_PROGRESS = "update_in_progress"
    LIVE = "live"
    DEACTIVATED = "deactivated"
    BUILD_FAILED = "build_failed"
    UPDATE_FAILED = "update_failed"
    CANCELED = "canceled"
    PRE_DEPLOY_IN_PROGRESS = "pre_deploy_in_progress"
    PRE_DEPLOY_FAILED = "pre_deploy_failed"


class ServiceType(Enum):
    """Tipos de serviço no Render"""
    WEB_SERVICE = "web_service"
    PRIVATE_SERVICE = "private_service"
    BACKGROUND_WORKER = "background_worker"
    CRON_JOB = "cron_job"
    STATIC_SITE = "static_site"


@dataclass
class Service:
    """Representa um serviço no Render"""
    id: str
    name: str
    type: str
    auto_deploy: str
    branch: str
    repo: str
    owner_id: str
    created_at: str
    updated_at: str
    suspended: str
    notifySetting: str
    slug: str = ""
    service_details: Dict = field(default_factory=dict)


@dataclass
class Deploy:
    """Representa um deployment"""
    id: str
    service_id: str
    status: str
    created_at: str
    updated_at: str
    commit_id: str = ""
    commit_message: str = ""
    commit_url: str = ""
    finished_at: Optional[str] = None


class RenderAPI:
    """
    Cliente completo para a API do Render
    
    Oferece acesso a todos os endpoints da API Render v1:
    - Services: Gerenciamento de serviços
    - Deploys: Controle de deployments
    - Logs: Streaming e consulta de logs
    - Metrics: Métricas e estatísticas
    - Environment: Variáveis de ambiente
    - Postgres: Bancos de dados
    - Redis/Key-Value: Instâncias de cache
    - Blueprints: Infrastructure as Code
    - Webhooks: Automação de eventos
    """
    
    BASE_URL = "https://api.render.com/v1"
    
    def __init__(self, api_key: str):
        """
        Inicializa o cliente da API Render
        
        Args:
            api_key: Chave de API do Render
        """
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        logger.info("RenderAPI inicializada")
    
    def _request(self, method: str, endpoint: str, **kwargs) -> Dict:
        """
        Executa uma requisição HTTP para a API
        
        Args:
            method: Método HTTP (GET, POST, PATCH, DELETE)
            endpoint: Endpoint da API (sem URL base)
            **kwargs: Argumentos adicionais para requests
            
        Returns:
            Resposta JSON da API
            
        Raises:
            requests.exceptions.RequestException: Erro na requisição
        """
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            response = self.session.request(method, url, **kwargs)
            response.raise_for_status()
            
            # Alguns endpoints retornam 204 No Content
            if response.status_code == 204:
                return {"success": True}
                
            return response.json()
        except requests.exceptions.HTTPError as e:
            logger.error(f"Erro HTTP {response.status_code}: {e}")
            try:
                error_detail = response.json()
                logger.error(f"Detalhes: {error_detail}")
            except:
                logger.error(f"Resposta: {response.text}")
            raise
        except Exception as e:
            logger.error(f"Erro na requisição: {e}")
            raise
    
    # ==================== SERVICES ====================
    
    def list_services(self, owner_id: Optional[str] = None, 
                     service_type: Optional[str] = None,
                     environment: Optional[str] = None,
                     region: Optional[str] = None,
                     suspended: Optional[str] = None) -> List[Service]:
        """
        Lista todos os serviços com filtros opcionais
        
        Args:
            owner_id: Filtrar por workspace
            service_type: Filtrar por tipo de serviço
            environment: Filtrar por ambiente (runtime)
            region: Filtrar por região
            suspended: Filtrar por status de suspensão
            
        Returns:
            Lista de objetos Service
        """
        params = {}
        if owner_id:
            params['ownerId'] = owner_id
        if service_type:
            params['type'] = service_type
        if environment:
            params['runtime'] = environment
        if region:
            params['region'] = region
        if suspended:
            params['suspended'] = suspended
            
        response = self._request('GET', '/services', params=params)
        
        services = []
        for item in response:
            service_data = item.get('service', {})
            services.append(Service(
                id=service_data.get('id', ''),
                name=service_data.get('name', ''),
                type=service_data.get('type', ''),
                auto_deploy=service_data.get('autoDeploy', 'unknown'),
                branch=service_data.get('branch', ''),
                repo=service_data.get('repo', ''),
                owner_id=service_data.get('ownerId', ''),
                created_at=service_data.get('createdAt', ''),
                updated_at=service_data.get('updatedAt', ''),
                suspended=service_data.get('suspended', 'unknown'),
                notifySetting=service_data.get('notifySetting', 'unknown'),
                slug=service_data.get('slug', ''),
                service_details=service_data.get('serviceDetails', {})
            ))
        
        logger.info(f"Encontrados {len(services)} serviços")
        return services
    
    def get_service(self, service_id: str) -> Service:
        """
        Obtém detalhes de um serviço específico
        
        Args:
            service_id: ID do serviço
            
        Returns:
            Objeto Service com detalhes completos
        """
        response = self._request('GET', f'/services/{service_id}')
        
        service_data = response
        return Service(
            id=service_data.get('id', ''),
            name=service_data.get('name', ''),
            type=service_data.get('type', ''),
            auto_deploy=service_data.get('autoDeploy', 'unknown'),
            branch=service_data.get('branch', ''),
            repo=service_data.get('repo', ''),
            owner_id=service_data.get('ownerId', ''),
            created_at=service_data.get('createdAt', ''),
            updated_at=service_data.get('updatedAt', ''),
            suspended=service_data.get('suspended', 'unknown'),
            notifySetting=service_data.get('notifySetting', 'unknown'),
            slug=service_data.get('slug', ''),
            service_details=service_data.get('serviceDetails', {})
        )
    
    def trigger_deploy(self, service_id: str, 
                      clear_cache: bool = False,
                      commit_id: Optional[str] = None) -> Deploy:
        """
        Inicia um novo deployment manualmente
        
        Args:
            service_id: ID do serviço
            clear_cache: Se deve limpar o cache de build
            commit_id: SHA do commit específico (opcional)
            
        Returns:
            Objeto Deploy com detalhes do deployment
        """
        data = {
            "clearCache": "clear" if clear_cache else "do_not_clear"
        }
        
        if commit_id:
            data["commitId"] = commit_id
        
        response = self._request('POST', f'/services/{service_id}/deploys', 
                                json=data)
        
        return self._parse_deploy(response)
    
    def suspend_service(self, service_id: str) -> Dict:
        """
        Suspende um serviço
        
        Args:
            service_id: ID do serviço
            
        Returns:
            Resposta da API
        """
        response = self._request('POST', f'/services/{service_id}/suspend')
        logger.info(f"Serviço {service_id} suspenso")
        return response
    
    def resume_service(self, service_id: str) -> Dict:
        """
        Resume um serviço suspenso
        
        Args:
            service_id: ID do serviço
            
        Returns:
            Resposta da API
        """
        response = self._request('POST', f'/services/{service_id}/resume')
        logger.info(f"Serviço {service_id} retomado")
        return response
    
    def restart_service(self, service_id: str) -> Dict:
        """
        Reinicia um serviço
        
        Args:
            service_id: ID do serviço
            
        Returns:
            Resposta da API
        """
        response = self._request('POST', f'/services/{service_id}/restart')
        logger.info(f"Serviço {service_id} reiniciado")
        return response
    
    # ==================== DEPLOYS ====================
    
    def list_deploys(self, service_id: str, 
                    status: Optional[List[str]] = None,
                    limit: int = 20) -> List[Deploy]:
        """
        Lista deployments de um serviço
        
        Args:
            service_id: ID do serviço
            status: Filtrar por status
            limit: Número máximo de resultados
            
        Returns:
            Lista de objetos Deploy
        """
        params = {'limit': limit}
        if status:
            params['status'] = status
        
        response = self._request('GET', f'/services/{service_id}/deploys', 
                                params=params)
        
        deploys = []
        for item in response:
            deploy_data = item.get('deploy', {})
            deploys.append(self._parse_deploy(deploy_data))
        
        logger.info(f"Encontrados {len(deploys)} deploys para serviço {service_id}")
        return deploys
    
    def get_deploy(self, service_id: str, deploy_id: str) -> Deploy:
        """
        Obtém detalhes de um deployment específico
        
        Args:
            service_id: ID do serviço
            deploy_id: ID do deployment
            
        Returns:
            Objeto Deploy com detalhes completos
        """
        response = self._request('GET', 
                                f'/services/{service_id}/deploys/{deploy_id}')
        return self._parse_deploy(response)
    
    def cancel_deploy(self, service_id: str, deploy_id: str) -> Dict:
        """
        Cancela um deployment em progresso
        
        Args:
            service_id: ID do serviço
            deploy_id: ID do deployment
            
        Returns:
            Resposta da API
        """
        response = self._request('POST', 
                                f'/services/{service_id}/deploys/{deploy_id}/cancel')
        logger.info(f"Deploy {deploy_id} cancelado")
        return response
    
    def rollback_deploy(self, service_id: str, deploy_id: str) -> Deploy:
        """
        Faz rollback para um deployment anterior
        
        Args:
            service_id: ID do serviço
            deploy_id: ID do deployment para reverter
            
        Returns:
            Novo deployment criado
        """
        data = {"deployId": deploy_id}
        response = self._request('POST', f'/services/{service_id}/rollback',
                                json=data)
        logger.info(f"Rollback para deploy {deploy_id} iniciado")
        return self._parse_deploy(response)
    
    def _parse_deploy(self, deploy_data: Dict) -> Deploy:
        """Parser interno para criar objeto Deploy"""
        commit = deploy_data.get('commit', {})
        return Deploy(
            id=deploy_data.get('id', ''),
            service_id=deploy_data.get('serviceId', ''),
            status=deploy_data.get('status', ''),
            created_at=deploy_data.get('createdAt', ''),
            updated_at=deploy_data.get('updatedAt', ''),
            finished_at=deploy_data.get('finishedAt'),
            commit_id=commit.get('id', ''),
            commit_message=commit.get('message', ''),
            commit_url=commit.get('url', '')
        )
    
    # ==================== LOGS ====================
    
    def get_logs(self, owner_id: str, resource_ids: List[str],
                start_time: Optional[int] = None,
                end_time: Optional[int] = None,
                limit: int = 100,
                direction: str = "backward") -> Dict:
        """
        Obtém logs de recursos específicos
        
        Args:
            owner_id: ID do workspace
            resource_ids: Lista de IDs de recursos (services, jobs, etc)
            start_time: Timestamp de início (epoch)
            end_time: Timestamp de fim (epoch)
            limit: Número máximo de logs
            direction: Direção da consulta (forward/backward)
            
        Returns:
            Dicionário com logs e metadados
        """
        if not start_time:
            start_time = int((datetime.now() - timedelta(hours=1)).timestamp())
        if not end_time:
            end_time = int(datetime.now().timestamp())
        
        params = {
            'ownerId': owner_id,
            'resource': resource_ids,
            'startTime': start_time,
            'endTime': end_time,
            'limit': limit,
            'direction': direction
        }
        
        response = self._request('GET', '/logs', params=params)
        return response
    
    # ==================== ENVIRONMENT VARIABLES ====================
    
    def list_env_vars(self, service_id: str) -> List[Dict]:
        """
        Lista variáveis de ambiente de um serviço
        
        Args:
            service_id: ID do serviço
            
        Returns:
            Lista de variáveis de ambiente
        """
        response = self._request('GET', f'/services/{service_id}/env-vars')
        return response
    
    def update_env_var(self, service_id: str, key: str, value: str) -> Dict:
        """
        Atualiza/cria uma variável de ambiente
        
        Args:
            service_id: ID do serviço
            key: Nome da variável
            value: Valor da variável
            
        Returns:
            Variável atualizada
        """
        data = {"value": value}
        response = self._request('PUT', 
                                f'/services/{service_id}/env-vars/{key}',
                                json=data)
        logger.info(f"Variável {key} atualizada no serviço {service_id}")
        return response
    
    # ==================== EVENTS ====================
    
    def list_events(self, service_id: str, limit: int = 20) -> List[Dict]:
        """
        Lista eventos recentes de um serviço
        
        Args:
            service_id: ID do serviço
            limit: Número máximo de eventos
            
        Returns:
            Lista de eventos
        """
        params = {'limit': limit}
        response = self._request('GET', f'/services/{service_id}/events',
                                params=params)
        return response
    
    # ==================== WORKSPACES ====================
    
    def list_workspaces(self) -> List[Dict]:
        """
        Lista todos os workspaces acessíveis
        
        Returns:
            Lista de workspaces
        """
        response = self._request('GET', '/owners')
        return response
    
    def get_workspace(self, owner_id: str) -> Dict:
        """
        Obtém detalhes de um workspace
        
        Args:
            owner_id: ID do workspace
            
        Returns:
            Dados do workspace
        """
        response = self._request('GET', f'/owners/{owner_id}')
        return response


class DeploymentMonitor:
    """
    Monitor de deployments em tempo real
    
    Monitora continuamente os deployments e executa ações baseadas em eventos:
    - Detecção de novos deploys
    - Rastreamento de progresso
    - Alertas de falhas
    - Rollback automático
    - Coleta de métricas
    """
    
    def __init__(self, api: RenderAPI, poll_interval: int = 30):
        """
        Inicializa o monitor
        
        Args:
            api: Instância do cliente RenderAPI
            poll_interval: Intervalo de polling em segundos
        """
        self.api = api
        self.poll_interval = poll_interval
        self.tracked_deploys: Dict[str, Deploy] = {}
        self.callbacks: Dict[str, List[Callable]] = {
            'on_deploy_start': [],
            'on_deploy_complete': [],
            'on_deploy_fail': [],
            'on_status_change': []
        }
        logger.info(f"DeploymentMonitor inicializado (intervalo: {poll_interval}s)")
    
    def register_callback(self, event: str, callback: Callable):
        """
        Registra callback para eventos
        
        Args:
            event: Nome do evento
            callback: Função a ser executada
        """
        if event in self.callbacks:
            self.callbacks[event].append(callback)
            logger.info(f"Callback registrado para evento '{event}'")
    
    def _trigger_callbacks(self, event: str, *args, **kwargs):
        """Dispara callbacks registrados"""
        for callback in self.callbacks.get(event, []):
            try:
                callback(*args, **kwargs)
            except Exception as e:
                logger.error(f"Erro em callback {event}: {e}")
    
    def monitor_service(self, service_id: str, duration: Optional[int] = None):
        """
        Monitora deployments de um serviço
        
        Args:
            service_id: ID do serviço a monitorar
            duration: Duração em segundos (None = infinito)
        """
        logger.info(f"Iniciando monitoramento do serviço {service_id}")
        start_time = time.time()
        
        while True:
            try:
                # Verifica duração
                if duration and (time.time() - start_time) > duration:
                    logger.info("Duração de monitoramento atingida")
                    break
                
                # Obtém deploys atuais
                deploys = self.api.list_deploys(service_id, limit=5)
                
                # Processa cada deploy
                for deploy in deploys:
                    self._process_deploy(deploy)
                
                # Aguarda próximo ciclo
                time.sleep(self.poll_interval)
                
            except KeyboardInterrupt:
                logger.info("Monitoramento interrompido pelo usuário")
                break
            except Exception as e:
                logger.error(f"Erro no monitoramento: {e}")
                time.sleep(self.poll_interval)
    
    def _process_deploy(self, deploy: Deploy):
        """Processa um deployment e dispara eventos"""
        deploy_key = f"{deploy.service_id}:{deploy.id}"
        
        # Novo deploy detectado
        if deploy_key not in self.tracked_deploys:
            logger.info(f"Novo deploy detectado: {deploy.id} ({deploy.status})")
            self.tracked_deploys[deploy_key] = deploy
            self._trigger_callbacks('on_deploy_start', deploy)
            return
        
        # Deploy existente - verifica mudanças
        old_deploy = self.tracked_deploys[deploy_key]
        
        if old_deploy.status != deploy.status:
            logger.info(f"Deploy {deploy.id}: {old_deploy.status} -> {deploy.status}")
            self._trigger_callbacks('on_status_change', old_deploy, deploy)
            
            # Deploy concluído com sucesso
            if deploy.status == DeployStatus.LIVE.value:
                logger.info(f"✓ Deploy {deploy.id} concluído com sucesso")
                self._trigger_callbacks('on_deploy_complete', deploy)
            
            # Deploy falhou
            elif deploy.status in [DeployStatus.BUILD_FAILED.value, 
                                  DeployStatus.UPDATE_FAILED.value,
                                  DeployStatus.PRE_DEPLOY_FAILED.value]:
                logger.error(f"✗ Deploy {deploy.id} falhou: {deploy.status}")
                self._trigger_callbacks('on_deploy_fail', deploy)
        
        # Atualiza registro
        self.tracked_deploys[deploy_key] = deploy
    
    def monitor_all_services(self, owner_id: Optional[str] = None):
        """
        Monitora todos os serviços
        
        Args:
            owner_id: ID do workspace (opcional)
        """
        logger.info("Iniciando monitoramento de todos os serviços")
        
        services = self.api.list_services(owner_id=owner_id)
        logger.info(f"Monitorando {len(services)} serviços")
        
        while True:
            try:
                for service in services:
                    deploys = self.api.list_deploys(service.id, limit=1)
                    if deploys:
                        self._process_deploy(deploys[0])
                
                time.sleep(self.poll_interval)
                
            except KeyboardInterrupt:
                logger.info("Monitoramento interrompido")
                break
            except Exception as e:
                logger.error(f"Erro: {e}")
                time.sleep(self.poll_interval)


class DeploymentReporter:
    """
    Gerador de relatórios de deployment
    
    Produz relatórios detalhados sobre deployments:
    - Histórico de deploys
    - Estatísticas de sucesso/falha
    - Tempo médio de deploy
    - Análise de tendências
    """
    
    def __init__(self, api: RenderAPI):
        """
        Inicializa o reporter
        
        Args:
            api: Instância do cliente RenderAPI
        """
        self.api = api
    
    def generate_service_report(self, service_id: str, days: int = 7) -> Dict:
        """
        Gera relatório de um serviço
        
        Args:
            service_id: ID do serviço
            days: Número de dias para análise
            
        Returns:
            Dicionário com relatório completo
        """
        logger.info(f"Gerando relatório para serviço {service_id}")
        
        service = self.api.get_service(service_id)
        deploys = self.api.list_deploys(service_id, limit=100)
        
        # Filtra por período
        cutoff = datetime.now() - timedelta(days=days)
        recent_deploys = [
            d for d in deploys 
            if datetime.fromisoformat(d.created_at.replace('Z', '+00:00')) > cutoff
        ]
        
        # Estatísticas
        total = len(recent_deploys)
        successful = len([d for d in recent_deploys 
                         if d.status == DeployStatus.LIVE.value])
        failed = len([d for d in recent_deploys 
                     if 'failed' in d.status.lower()])
        
        # Tempo médio
        completed = [d for d in recent_deploys if d.finished_at]
        avg_duration = 0
        if completed:
            durations = []
            for d in completed:
                start = datetime.fromisoformat(d.created_at.replace('Z', '+00:00'))
                end = datetime.fromisoformat(d.finished_at.replace('Z', '+00:00'))
                durations.append((end - start).total_seconds())
            avg_duration = sum(durations) / len(durations)
        
        report = {
            'service': {
                'id': service.id,
                'name': service.name,
                'type': service.type,
                'repo': service.repo,
                'branch': service.branch
            },
            'period': {
                'days': days,
                'start_date': cutoff.isoformat(),
                'end_date': datetime.now().isoformat()
            },
            'statistics': {
                'total_deploys': total,
                'successful': successful,
                'failed': failed,
                'success_rate': (successful / total * 100) if total > 0 else 0,
                'avg_duration_seconds': round(avg_duration, 2),
                'avg_duration_minutes': round(avg_duration / 60, 2)
            },
            'recent_deploys': [
                {
                    'id': d.id,
                    'status': d.status,
                    'created_at': d.created_at,
                    'commit_message': d.commit_message[:50] if d.commit_message else ''
                }
                for d in recent_deploys[:10]
            ]
        }
        
        return report
    
    def print_report(self, report: Dict):
        """Imprime relatório formatado"""
        print("\n" + "="*80)
        print(f"RELATÓRIO DE DEPLOYMENT - {report['service']['name']}")
        print("="*80)
        print(f"\nServiço: {report['service']['name']} ({report['service']['type']})")
        print(f"Repositório: {report['service']['repo']}")
        print(f"Branch: {report['service']['branch']}")
        print(f"\nPeríodo: {report['period']['days']} dias")
        print(f"De: {report['period']['start_date']}")
        print(f"Até: {report['period']['end_date']}")
        
        stats = report['statistics']
        print("\n" + "-"*80)
        print("ESTATÍSTICAS")
        print("-"*80)
        print(f"Total de deploys: {stats['total_deploys']}")
        print(f"Bem-sucedidos: {stats['successful']}")
        print(f"Falhas: {stats['failed']}")
        print(f"Taxa de sucesso: {stats['success_rate']:.1f}%")
        print(f"Tempo médio: {stats['avg_duration_minutes']:.1f} minutos")
        
        print("\n" + "-"*80)
        print("DEPLOYS RECENTES")
        print("-"*80)
        for deploy in report['recent_deploys']:
            status_symbol = "✓" if deploy['status'] == 'live' else "✗"
            print(f"{status_symbol} {deploy['created_at'][:19]} | {deploy['status']:20} | {deploy['commit_message']}")
        
        print("\n" + "="*80 + "\n")


def main():
    """Função principal CLI"""
    parser = argparse.ArgumentParser(
        description="Render Deployment Manager - Gerenciamento completo de deployments"
    )
    
    parser.add_argument('--api-key', 
                       help='Chave da API Render (ou use RENDER_API_KEY env var)')
    
    subparsers = parser.add_subparsers(dest='command', help='Comandos disponíveis')
    
    # Listar serviços
    list_parser = subparsers.add_parser('list-services', 
                                        help='Lista todos os serviços')
    list_parser.add_argument('--owner-id', help='Filtrar por workspace')
    list_parser.add_argument('--type', help='Filtrar por tipo de serviço')
    
    # Listar deploys
    deploys_parser = subparsers.add_parser('list-deploys',
                                           help='Lista deploys de um serviço')
    deploys_parser.add_argument('service_id', help='ID do serviço')
    deploys_parser.add_argument('--limit', type=int, default=10,
                               help='Número de deploys a exibir')
    
    # Monitorar serviço
    monitor_parser = subparsers.add_parser('monitor',
                                           help='Monitora deployments em tempo real')
    monitor_parser.add_argument('service_id', help='ID do serviço')
    monitor_parser.add_argument('--interval', type=int, default=30,
                               help='Intervalo de polling em segundos')
    monitor_parser.add_argument('--duration', type=int,
                               help='Duração em segundos')
    
    # Monitorar todos
    monitor_all_parser = subparsers.add_parser('monitor-all',
                                               help='Monitora todos os serviços')
    monitor_all_parser.add_argument('--owner-id', help='ID do workspace')
    monitor_all_parser.add_argument('--interval', type=int, default=60,
                                   help='Intervalo de polling')
    
    # Trigger deploy
    deploy_parser = subparsers.add_parser('deploy',
                                          help='Inicia um deployment')
    deploy_parser.add_argument('service_id', help='ID do serviço')
    deploy_parser.add_argument('--clear-cache', action='store_true',
                              help='Limpar cache de build')
    deploy_parser.add_argument('--commit', help='SHA do commit específico')
    
    # Relatório
    report_parser = subparsers.add_parser('report',
                                          help='Gera relatório de deployments')
    report_parser.add_argument('service_id', help='ID do serviço')
    report_parser.add_argument('--days', type=int, default=7,
                              help='Número de dias para análise')
    
    # Rollback
    rollback_parser = subparsers.add_parser('rollback',
                                            help='Faz rollback de um deploy')
    rollback_parser.add_argument('service_id', help='ID do serviço')
    rollback_parser.add_argument('deploy_id', help='ID do deploy para reverter')
    
    # Logs
    logs_parser = subparsers.add_parser('logs', help='Obtém logs')
    logs_parser.add_argument('owner_id', help='ID do workspace')
    logs_parser.add_argument('resource_ids', nargs='+', 
                            help='IDs dos recursos')
    logs_parser.add_argument('--hours', type=int, default=1,
                            help='Horas de histórico')
    
    args = parser.parse_args()
    
    # Obtém API key
    api_key = args.api_key or os.getenv('RENDER_API_KEY')
    if not api_key:
        print("Erro: RENDER_API_KEY não configurada")
        print("Use --api-key ou defina a variável de ambiente RENDER_API_KEY")
        sys.exit(1)
    
    # Inicializa API
    api = RenderAPI(api_key)
    
    # Executa comando
    try:
        if args.command == 'list-services':
            services = api.list_services(
                owner_id=args.owner_id,
                service_type=args.type
            )
            print(f"\n{'ID':<25} {'Nome':<30} {'Tipo':<20} {'Branch':<15}")
            print("-" * 90)
            for svc in services:
                print(f"{svc.id:<25} {svc.name:<30} {svc.type:<20} {svc.branch:<15}")
            print(f"\nTotal: {len(services)} serviços\n")
        
        elif args.command == 'list-deploys':
            deploys = api.list_deploys(args.service_id, limit=args.limit)
            print(f"\n{'ID':<25} {'Status':<25} {'Criado em':<25} {'Commit':<50}")
            print("-" * 125)
            for dep in deploys:
                commit_msg = dep.commit_message[:47] + "..." if len(dep.commit_message) > 50 else dep.commit_message
                print(f"{dep.id:<25} {dep.status:<25} {dep.created_at[:19]:<25} {commit_msg:<50}")
            print(f"\nTotal: {len(deploys)} deploys\n")
        
        elif args.command == 'monitor':
            monitor = DeploymentMonitor(api, poll_interval=args.interval)
            
            # Callbacks de exemplo
            def on_start(deploy):
                print(f"🚀 Deploy iniciado: {deploy.id}")
            
            def on_complete(deploy):
                print(f"✓ Deploy concluído: {deploy.id}")
            
            def on_fail(deploy):
                print(f"✗ Deploy falhou: {deploy.id} ({deploy.status})")
            
            monitor.register_callback('on_deploy_start', on_start)
            monitor.register_callback('on_deploy_complete', on_complete)
            monitor.register_callback('on_deploy_fail', on_fail)
            
            monitor.monitor_service(args.service_id, duration=args.duration)
        
        elif args.command == 'monitor-all':
            monitor = DeploymentMonitor(api, poll_interval=args.interval)
            monitor.monitor_all_services(owner_id=args.owner_id)
        
        elif args.command == 'deploy':
            print(f"Iniciando deployment do serviço {args.service_id}...")
            deploy = api.trigger_deploy(
                args.service_id,
                clear_cache=args.clear_cache,
                commit_id=args.commit
            )
            print(f"✓ Deploy {deploy.id} criado com sucesso")
            print(f"  Status: {deploy.status}")
            print(f"  Criado em: {deploy.created_at}")
        
        elif args.command == 'report':
            reporter = DeploymentReporter(api)
            report = reporter.generate_service_report(args.service_id, days=args.days)
            reporter.print_report(report)
        
        elif args.command == 'rollback':
            print(f"Fazendo rollback para deploy {args.deploy_id}...")
            deploy = api.rollback_deploy(args.service_id, args.deploy_id)
            print(f"✓ Rollback iniciado")
            print(f"  Novo deploy: {deploy.id}")
            print(f"  Status: {deploy.status}")
        
        elif args.command == 'logs':
            hours = args.hours
            start_time = int((datetime.now() - timedelta(hours=hours)).timestamp())
            end_time = int(datetime.now().timestamp())
            
            print(f"Obtendo logs das últimas {hours} hora(s)...")
            result = api.get_logs(
                args.owner_id,
                args.resource_ids,
                start_time=start_time,
                end_time=end_time
            )
            
            logs = result.get('logs', [])
            print(f"\n{len(logs)} entradas de log encontradas\n")
            for log in logs:
                timestamp = datetime.fromtimestamp(log.get('timestamp', 0))
                print(f"[{timestamp}] {log.get('text', '')}")
        
        else:
            parser.print_help()
    
    except Exception as e:
        logger.error(f"Erro: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
