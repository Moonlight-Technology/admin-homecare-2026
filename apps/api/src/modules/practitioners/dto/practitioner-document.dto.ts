import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from '../../documents/document-policy';

export class PractitionerDocumentUploadDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) fileName: string;
  @ApiProperty({ enum: ALLOWED_DOCUMENT_TYPES }) @IsIn(ALLOWED_DOCUMENT_TYPES) mimeType: string;
  @ApiProperty({ minimum: 1, maximum: MAX_DOCUMENT_BYTES }) @IsInt() @Min(1) @Max(MAX_DOCUMENT_BYTES) sizeBytes: number;
}

export class PractitionerDocumentCompleteDto {
  @ApiProperty() @IsUUID() documentId: string;
}
