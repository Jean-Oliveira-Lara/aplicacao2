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

interface PackMessage {
  id: string;
  name: string;
  text: string;
}

interface MessagePack {
  id: string;
  messages: PackMessage[];
  /**
   * Correções: troca mensagens de um pacote anterior por outra, na mesma
   * posição da lista. Só troca as que continuam com o texto original
   * (se você editou, a sua versão é mantida).
   */
  replace?: { ids: string[]; originalTexts: Record<string, string>; with: PackMessage }[];
}

const THANKS_TEXT = 'Deus abençoe e faça prosperar ainda mais!!';
const RECEIPT_TEXT = 'Só me manda o comprovante aqui por questões de controle financeiro, ótima semana 🙌🏽';

/** As duas primeiras mensagens do pacote 1 eram uma só mensagem. */
const MERGED_THANKS_RECEIPT: PackMessage = {
  id: 'pack-1-agradecimento-comprovante',
  name: 'Agradecimento + comprovante',
  text: `${THANKS_TEXT}\n\n${RECEIPT_TEXT}`,
};

const PACKS: MessagePack[] = [
  {
    id: 'pack-1',
    messages: [
      MERGED_THANKS_RECEIPT,
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
  {
    // Correção para aparelhos que receberam o pacote 1 com as duas
    // mensagens separadas: une as duas numa só, no mesmo lugar.
    id: 'pack-2',
    messages: [],
    replace: [
      {
        ids: ['pack-1-agradecimento', 'pack-1-comprovante'],
        originalTexts: {
          'pack-1-agradecimento': THANKS_TEXT,
          'pack-1-comprovante': RECEIPT_TEXT,
        },
        with: MERGED_THANKS_RECEIPT,
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

    let list = [...current];
    for (const pack of pending) {
      for (const message of pack.messages) {
        if (existingIds.has(message.id)) continue;
        list.push({ ...message, createdAt: now, updatedAt: now });
        existingIds.add(message.id);
      }
      for (const rule of pack.replace ?? []) {
        const untouched = (m: QuickMessage) =>
          rule.ids.includes(m.id) && m.text === rule.originalTexts[m.id];
        const position = list.findIndex(untouched);
        if (position === -1 || existingIds.has(rule.with.id)) continue;
        const replacement: QuickMessage = { ...rule.with, createdAt: now, updatedAt: now };
        list = list.filter((m) => !untouched(m));
        list.splice(Math.min(position, list.length), 0, replacement);
        existingIds.add(rule.with.id);
      }
      applied.add(pack.id);
    }

    window.localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(list));
    window.localStorage.setItem(APPLIED_PACKS_KEY, JSON.stringify([...applied]));
  } catch (error) {
    console.error('Falha ao adicionar o pacote de mensagens', error);
  }
}
