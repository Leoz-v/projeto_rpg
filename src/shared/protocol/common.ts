import { z } from 'zod';
import { MAX_CELL_PX, MAX_MAP_CELLS } from './constants';

/** Ids de mensagens, jogadores, campanhas e de tudo o que o Host gera. */
export const UuidSchema = z.uuid();

/** SHA-256 de um asset: 64 caracteres hexadecimais minúsculos. */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 inválido');

/** Posição em unidades de mundo (canto superior esquerdo do token). */
export const PointSchema = z.strictObject({ x: z.int().nonnegative(), y: z.int().nonnegative() });
export type Point = z.infer<typeof PointSchema>;

export const NameSchema = z.string().min(1).max(100);
export const LabelSchema = z.string().min(1).max(100);
export const ChatTextSchema = z.string().min(1).max(2000);
/** Mapas têm de 1 a 200 células por lado. */
export const MapCellsSchema = z.int().min(1).max(MAX_MAP_CELLS);
/** Pixels da imagem de fundo por célula do grid. */
export const MapCellPxSchema = z.int().min(1).max(MAX_CELL_PX);
