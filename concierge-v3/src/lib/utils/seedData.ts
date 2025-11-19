/**
 * Seed Data
 * Purpose: Initialize app with sample data for development/demo
 * Dependencies: stores
 * 
 * Usage:
 *   import { seedData } from '$lib/utils/seedData';
 *   seedData(); // populate stores with sample curations
 */

import { addCuration } from '$lib/stores/curations';
import { login } from '$lib/stores/user';

export function seedData() {
	// Seed user
	login({
		id: 'user-1',
		name: 'Wagner Montes',
		email: 'wagner@concierge.app',
		curatorId: 'curator-1',
		apiKey: 'sk_test_demo_key_12345',
		createdAt: '2025-01-01T00:00:00.000Z'
	});

	// Seed curations
	const sampleCurations = [
		{
			title: 'Oteque - Rio de Janeiro',
			placeName: 'Oteque',
			status: 'published' as const,
			transcription: 'Experiência incrível no Oteque. O menu degustação de 8 tempos foi excepcional. Destaque para o prato de robalo com tucupi, que trouxe elementos da cozinha amazônica de forma contemporânea. O atendimento foi impecável, com sommeliers muito bem preparados. A carta de vinhos tem excelente curadoria com foco em rótulos brasileiros e sul-americanos.',
			concepts: [
				{ category: 'Ambiance', name: 'Contemporary' },
				{ category: 'Food', name: 'Innovation' },
				{ category: 'Service', name: 'Professional' },
				{ category: 'Cuisine', name: 'Brazilian' }
			],
			notes: 'Reserva com 2 meses de antecedência. Menu degustação R$ 650/pessoa. Vale muito a pena!'
		},
		{
			title: 'D.O.M. - São Paulo',
			placeName: 'D.O.M.',
			status: 'published' as const,
			transcription: 'O D.O.M. do Alex Atala é referência mundial em gastronomia brasileira. A experiência vai além da comida, é uma aula sobre ingredientes nativos. Provei formiga saúva pela primeira vez e foi surpreendente. O risoto de pupunha estava perfeito. Ambiente sofisticado mas acolhedor.',
			concepts: [
				{ category: 'Food', name: 'Indigenous Ingredients' },
				{ category: 'Ambiance', name: 'Sophisticated' },
				{ category: 'Cuisine', name: 'Fine Dining' },
				{ category: 'Experience', name: 'Educational' }
			],
			notes: 'Melhor época: março a junho. Reservar com antecedência. Menu degustação ~R$ 800.'
		},
		{
			title: 'Lasai - Rio de Janeiro',
			placeName: 'Lasai',
			status: 'published' as const,
			transcription: 'Restaurante intimista com apenas 30 lugares. Cozinha aberta onde você vê todo o preparo. Menu muda diariamente baseado nos produtos da fazenda orgânica do chef. Comida honesta, sazonal e deliciosa. O pão de fermentação natural é incrível.',
			concepts: [
				{ category: 'Food', name: 'Farm to Table' },
				{ category: 'Food', name: 'Seasonal' },
				{ category: 'Food', name: 'Organic' },
				{ category: 'Ambiance', name: 'Intimate' }
			],
			notes: 'Reservar com 1 mês. Menu fechado ~R$ 400. Aceita restrições alimentares com aviso prévio.'
		},
		{
			title: 'Manioca - Espírito Santo',
			placeName: 'Manioca',
			status: 'draft' as const,
			transcription: 'Ainda preciso terminar esta curação. Restaurante focado em ingredientes capixabas, especialmente frutos do mar. A moqueca é diferente, mais leve que a tradicional.',
			concepts: [
				{ category: 'Cuisine', name: 'Regional' },
				{ category: 'Food', name: 'Seafood' }
			],
			notes: 'Preciso voltar para completar a avaliação.'
		},
		{
			title: 'Oro - Rio de Janeiro',
			placeName: 'Oro',
			status: 'draft' as const,
			transcription: 'Casa do chef Felipe Bronze. Comecei a curação mas ainda falta detalhes sobre a experiência completa.',
			concepts: [
				{ category: 'Cuisine', name: 'Contemporary' }
			]
		}
	];

	// Add curations with timestamps
	const now = new Date();
	sampleCurations.forEach((curation, index) => {
		// Space them out over the last 2 weeks
		const daysAgo = index * 3;
		const createdAt = new Date(now);
		createdAt.setDate(createdAt.getDate() - daysAgo);

		addCuration({
			...curation,
			createdAt: createdAt.toISOString(),
			updatedAt: createdAt.toISOString(),
			publishedAt: curation.status === 'published' ? createdAt.toISOString() : undefined
		} as any);
	});

	console.log('✅ Seeded data: 1 user, 5 curations (3 published, 2 draft)');
}
