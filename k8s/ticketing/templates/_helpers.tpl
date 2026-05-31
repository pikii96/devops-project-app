{{/*
============================================================================
Helper funkcije za Ticketing Helm chart
============================================================================
*/}}

{{/*
Vrati ime chart-a (default: ticketing).
Koristi se kao prefix za sva imena resursa.
*/}}
{{- define "ticketing.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Vrati puno ime release-a (npr. "ticketing-release").
Korišteno za generiranje DNS-friendly imena.
*/}}
{{- define "ticketing.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Standardne K8s labels koje idu na svaki resurs.
Tako brzo grupiramo sve resurse jednog release-a:
  kubectl get all -l app.kubernetes.io/instance=ticketing
*/}}
{{- define "ticketing.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "ticketing.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: ticketing-platform
{{- end }}

{{/*
Selector labels - manji set od "labels", služe za matching između
Deployment-a i Pod-ova. NE smiju se mijenjati nakon kreiranja Deployment-a!
*/}}
{{- define "ticketing.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ticketing.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component-specific labels za pojedinacni servis.
Primjer: include "ticketing.componentLabels" (dict "ctx" . "component" "api")
*/}}
{{- define "ticketing.componentLabels" -}}
{{- include "ticketing.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Component selector labels za pojedinacni servis.
*/}}
{{- define "ticketing.componentSelectorLabels" -}}
{{- include "ticketing.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Ime ServiceAccount-a.
*/}}
{{- define "ticketing.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (printf "%s-sa" (include "ticketing.fullname" .)) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Full image reference za pojedinacni servis.
Primjer: include "ticketing.image" (dict "ctx" . "image" .Values.api.image)
*/}}
{{- define "ticketing.image" -}}
{{- $tag := default .ctx.Values.global.imageTag .image.tag -}}
{{- printf "%s:%s" .image.repository $tag -}}
{{- end }}
