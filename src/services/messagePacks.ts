/**
 * Pacotes de mensagens prontas adicionados pelo dono do app.
 *
 * Cada pacote é aplicado UMA vez por aparelho: as mensagens são somadas
 * no fim da lista atual (nada é apagado ou substituído) e o pacote fica
 * marcado como aplicado. Se depois você editar ou excluir uma delas,
 * ela não volta. Tudo continua salvo só no navegador (localStorage).
 *
 * Para adicionar mais mensagens no futuro, crie um NOVO pacote com outro
 * id (ex.: 'pack-2') em vez de editar um pacote já aplicado.
 */
import type { QuickMessage } from '../types';
import { STORAGE_KEYS } from './storage';

const APPLIED_PACKS_KEY = 'discador:message-packs';

interface MessagePack {
  id: string;
  messages: { id: string; name: string; text: string }[];
}

const PACKS: MessagePack[] = [
  {
    id: 'pack-1',
    messages: [
      {
        id: 'pack-1-agradecimento',
        name: 'Agradecimento',
        text: 'Deus abençoe e faça prosperar ainda mais!!',
      },
      {
        id: 'pack-1-comprovante',
        name: 'Pedir comprovante',
        text: 'Só me manda o comprovante aqui por questões de controle financeiro, ótima semana 🙌🏽',
      },
      {
        id: 'pack-1-instagram-trajetoria',
        name: 'Instagram (trajetória)',
        text: 'julio_ostapenko acompanhe essa trajetória de perto rumo ao brasileiro mais uma vez 🦅',
      },
      {
        id: 'pack-1-pix',
        name: 'Pix',
        text: 'Pix 41995157474',
      },
      {
        id: 'pack-1-lembrete-pix-ele',
        name: 'Lembrete Pix (ele)',
        text: 'Boa noite, Meu querido tudo bom?  imagino que possivelmente tenha esquecido de fazer o Pix mas pode ficar tranquilo me manda na chave pix numero 41995157474',
      },
      {
        id: 'pack-1-lembrete-pix-ela',
        name: 'Lembrete Pix (ela)',
        text: 'Boa noite, querida tudo bem? Imagino que possivelmente tenha esquecido de fazer o Pix mas pode ficar tranquila me manda na chave pix numero 41995157474',
      },
      {
        id: 'pack-1-instagram',
        name: 'Instagram',
        text: 'Instagram @julio_ostapenko',
      },
      {
        id: 'pack-1-chave-pix',
        name: 'Chave Pix',
        text: 'Minha chave pix: 41995157474',
      },
    ],
  },
];

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/**
 * Aplica os pacotes ainda não aplicados neste aparelho. É síncrono de
 * propósito: lê e grava o localStorage de uma vez só, então duas telas
 * abrindo ao mesmo tempo não duplicam mensagens.
 *
 * @param seedIfEmpty mensagens usadas quando a lista ainda não existe
 *   (o mesmo valor inicial que o discador já usava).
 */
export function applyMessagePacks(seedIfEmpty: QuickMessage[]): void {
  try {
    if (typeof window === 'undefined') return;
    const applied = new Set(readJson<string[]>(APPLIED_PACKS_KEY) ?? []);
    const pending = PACKS.filter((pack) => !applied.has(pack.id));
    if (pending.length === 0) return;

    const stored = readJson<QuickMessage[]>(STORAGE_KEYS.messages);
    const current = stored && stored.length > 0 ? stored : seedIfEmpty;
    const existingIds = new Set(current.map((m) => m.id));
    const now = new Date().toISOString();

    const additions: QuickMessage[] = [];
    for (const pack of pending) {
      for (const message of pack.messages) {
        if (existingIds.has(message.id)) continue;
        additions.push({ ...message, createdAt: now, updatedAt: now });
        existingIds.add(message.id);
      }
      applied.add(pack.id);
    }

    window.localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify([...current, ...additions]));
    window.localStorage.setItem(APPLIED_PACKS_KEY, JSON.stringify([...applied]));
  } catch (error) {
    console.error('Falha ao adicionar o pacote de mensagens', error);
  }
}
