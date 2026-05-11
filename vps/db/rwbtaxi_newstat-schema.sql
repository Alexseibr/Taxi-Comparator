--
-- PostgreSQL database dump
--

\restrict 7KciezzjcTLa7lfxkoLovxF1Fcps2sKRL8aakTHhL6H3FBA7hwryoXjNTSvzged

-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: client_risk_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_risk_daily (
    client_id text NOT NULL,
    date date NOT NULL,
    cashback_exposure numeric(5,2) DEFAULT 0 NOT NULL,
    repeat_driver_dependency numeric(5,2) DEFAULT 0 NOT NULL,
    suspicious_activity numeric(5,2) DEFAULT 0 NOT NULL,
    total_risk numeric(5,2) DEFAULT 0 NOT NULL,
    cashback_money_byn numeric(12,2) DEFAULT 0 NOT NULL,
    money_at_risk_byn numeric(12,2) DEFAULT 0 NOT NULL,
    signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    recomputed_at timestamp with time zone DEFAULT now() NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id text NOT NULL,
    phone text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cashback_blocked boolean DEFAULT false NOT NULL,
    cashback_blocked_at timestamp with time zone,
    cashback_blocked_by text
);


--
-- Name: daily_client_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_client_stats (
    client_id text NOT NULL,
    date date NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL,
    completed_orders integer DEFAULT 0 NOT NULL,
    cancelled_orders integer DEFAULT 0 NOT NULL,
    noncash_orders integer DEFAULT 0 NOT NULL,
    noncash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    total_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    unique_drivers integer DEFAULT 0 NOT NULL,
    max_orders_with_one_driver integer DEFAULT 0 NOT NULL,
    repeat_driver_ratio numeric(5,4) DEFAULT 0 NOT NULL,
    short_trip_orders integer DEFAULT 0 NOT NULL,
    cashback_earned numeric(12,2) DEFAULT 0 NOT NULL,
    recomputed_at timestamp with time zone DEFAULT now() NOT NULL,
    cash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    fast_arrival_orders integer DEFAULT 0 NOT NULL
);


--
-- Name: daily_driver_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_driver_stats (
    driver_id text NOT NULL,
    date date NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL,
    completed_orders integer DEFAULT 0 NOT NULL,
    cancelled_orders integer DEFAULT 0 NOT NULL,
    noncash_orders integer DEFAULT 0 NOT NULL,
    cash_orders integer DEFAULT 0 NOT NULL,
    noncash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    cash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    total_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    short_trip_orders integer DEFAULT 0 NOT NULL,
    fast_arrival_orders integer DEFAULT 0 NOT NULL,
    unique_clients integer DEFAULT 0 NOT NULL,
    max_orders_with_one_client integer DEFAULT 0 NOT NULL,
    repeat_client_ratio numeric(5,4) DEFAULT 0 NOT NULL,
    avg_arrival_minutes numeric(6,2),
    avg_trip_minutes numeric(6,2),
    first_order_at timestamp with time zone,
    last_order_at timestamp with time zone,
    active_hours_mask integer DEFAULT 0 NOT NULL,
    recomputed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_pair_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_pair_stats (
    driver_id text NOT NULL,
    client_id text NOT NULL,
    date date NOT NULL,
    orders_count integer DEFAULT 0 NOT NULL,
    noncash_orders integer DEFAULT 0 NOT NULL,
    noncash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    total_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    short_trip_orders integer DEFAULT 0 NOT NULL,
    fast_arrival_orders integer DEFAULT 0 NOT NULL,
    recomputed_at timestamp with time zone DEFAULT now() NOT NULL,
    taken_orders integer DEFAULT 0 NOT NULL,
    cancel_after_accept_count integer DEFAULT 0 NOT NULL,
    cancel_after_accept_ratio numeric(5,4) DEFAULT 0 NOT NULL
);


--
-- Name: device_fingerprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_fingerprints (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    device_hash text NOT NULL,
    user_agent text,
    platform text,
    first_seen date NOT NULL,
    last_seen date NOT NULL,
    CONSTRAINT device_fingerprints_entity_type_check CHECK ((entity_type = ANY (ARRAY['driver'::text, 'client'::text])))
);


--
-- Name: device_fingerprints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_fingerprints_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_fingerprints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_fingerprints_id_seq OWNED BY public.device_fingerprints.id;


--
-- Name: driver_risk_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_risk_daily (
    driver_id text NOT NULL,
    date date NOT NULL,
    guarantee_risk numeric(5,2) DEFAULT 0 NOT NULL,
    earnings_risk numeric(5,2) DEFAULT 0 NOT NULL,
    collusion_risk numeric(5,2) DEFAULT 0 NOT NULL,
    total_risk numeric(5,2) DEFAULT 0 NOT NULL,
    guarantee_money_byn numeric(12,2) DEFAULT 0 NOT NULL,
    earnings_money_byn numeric(12,2) DEFAULT 0 NOT NULL,
    collusion_money_byn numeric(12,2) DEFAULT 0 NOT NULL,
    money_at_risk_byn numeric(12,2) DEFAULT 0 NOT NULL,
    signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    recomputed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: driver_shift_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_shift_attendance (
    driver_id text NOT NULL,
    date date NOT NULL,
    shift_id integer NOT NULL,
    shift_hours smallint NOT NULL,
    covered_hours smallint NOT NULL,
    attendance_pct numeric(5,2) NOT NULL,
    orders_in_shift integer NOT NULL,
    qualified boolean NOT NULL,
    payout_byn numeric(10,2) NOT NULL,
    recomputed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    id text NOT NULL,
    name text,
    phone text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fraud_ticket_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_ticket_events (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    action text NOT NULL,
    old_status text,
    new_status text,
    decision text,
    comment text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fraud_ticket_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_ticket_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_ticket_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_ticket_events_id_seq OWNED BY public.fraud_ticket_events.id;


--
-- Name: fraud_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_tickets (
    ticket_id bigint NOT NULL,
    entity_type text NOT NULL,
    driver_id text,
    client_id text,
    date date NOT NULL,
    risk_score numeric(5,2) NOT NULL,
    risk_type text NOT NULL,
    money_at_risk_byn numeric(12,2) DEFAULT 0 NOT NULL,
    money_saved_byn numeric(12,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    decision text,
    priority text DEFAULT 'low'::text NOT NULL,
    signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    suspicious_orders jsonb DEFAULT '[]'::jsonb NOT NULL,
    previous_flags_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text DEFAULT 'system'::text NOT NULL,
    assigned_to text,
    comment text,
    entity_key text GENERATED ALWAYS AS (((((entity_type || '|'::text) || COALESCE(driver_id, ''::text)) || '|'::text) || COALESCE(client_id, ''::text))) STORED,
    label_status text DEFAULT 'unlabeled'::text NOT NULL,
    label_value smallint,
    labeled_at timestamp with time zone,
    labeled_by text,
    trigger_reason text,
    evidence_confidence integer,
    CONSTRAINT fraud_tickets_decision_check CHECK (((decision IS NULL) OR (decision = ANY (ARRAY['deny_payout'::text, 'allow'::text, 'block_cashback'::text, 'monitor'::text])))),
    CONSTRAINT fraud_tickets_entity_shape CHECK ((((entity_type = 'driver'::text) AND (driver_id IS NOT NULL) AND (client_id IS NULL)) OR ((entity_type = 'client'::text) AND (client_id IS NOT NULL) AND (driver_id IS NULL)) OR ((entity_type = 'pair'::text) AND (driver_id IS NOT NULL) AND (client_id IS NOT NULL)))),
    CONSTRAINT fraud_tickets_entity_type_check CHECK ((entity_type = ANY (ARRAY['driver'::text, 'client'::text, 'pair'::text]))),
    CONSTRAINT fraud_tickets_label_status_check CHECK ((label_status = ANY (ARRAY['unlabeled'::text, 'labeled'::text]))),
    CONSTRAINT fraud_tickets_label_value_check CHECK (((label_value IS NULL) OR (label_value = ANY (ARRAY[0, 1])))),
    CONSTRAINT fraud_tickets_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT fraud_tickets_risk_type_check CHECK ((risk_type = ANY (ARRAY['guarantee'::text, 'earnings'::text, 'collusion'::text, 'cashback'::text]))),
    CONSTRAINT fraud_tickets_status_check CHECK ((status = ANY (ARRAY['new'::text, 'in_review'::text, 'confirmed_fraud'::text, 'false_positive'::text, 'closed'::text])))
);


--
-- Name: fraud_tickets_ticket_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_tickets_ticket_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_tickets_ticket_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_tickets_ticket_id_seq OWNED BY public.fraud_tickets.ticket_id;


--
-- Name: fraud_training_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_training_labels (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_key text NOT NULL,
    date date NOT NULL,
    label smallint NOT NULL,
    source_ticket_id bigint,
    ml_score numeric(6,4),
    rule_score numeric(6,2),
    graph_score numeric(6,2),
    final_score numeric(6,2),
    delta numeric(6,4),
    reviewed_by text,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fraud_training_labels_entity_type_check CHECK ((entity_type = ANY (ARRAY['pair'::text, 'driver'::text, 'client'::text, 'cluster'::text]))),
    CONSTRAINT fraud_training_labels_label_check CHECK ((label = ANY (ARRAY[0, 1])))
);


--
-- Name: fraud_training_labels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_training_labels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_training_labels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_training_labels_id_seq OWNED BY public.fraud_training_labels.id;


--
-- Name: graph_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_clusters (
    cluster_id text NOT NULL,
    nodes_count integer DEFAULT 0 NOT NULL,
    drivers_count integer DEFAULT 0 NOT NULL,
    clients_count integer DEFAULT 0 NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL,
    total_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    total_noncash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    total_cashback_generated numeric(12,2) DEFAULT 0 NOT NULL,
    total_cashback_risk numeric(12,2) DEFAULT 0 NOT NULL,
    total_collusion_loss_risk numeric(12,2) DEFAULT 0 NOT NULL,
    avg_risk_score numeric(5,2) DEFAULT 0 NOT NULL,
    max_risk_score numeric(5,2) DEFAULT 0 NOT NULL,
    is_suspicious boolean DEFAULT false NOT NULL,
    cluster_type text,
    reason jsonb DEFAULT '{}'::jsonb NOT NULL,
    window_from date,
    window_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: graph_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_edges (
    driver_id text NOT NULL,
    client_id text NOT NULL,
    date date NOT NULL,
    orders_count integer DEFAULT 0 NOT NULL,
    completed_orders integer DEFAULT 0 NOT NULL,
    noncash_orders integer DEFAULT 0 NOT NULL,
    total_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    noncash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    short_trip_count integer DEFAULT 0 NOT NULL,
    fast_arrival_count integer DEFAULT 0 NOT NULL,
    repeat_ratio numeric(5,2) DEFAULT 0 NOT NULL,
    pair_risk_score numeric(5,2) DEFAULT 0 NOT NULL,
    cashback_generated_byn numeric(12,2) DEFAULT 0 NOT NULL,
    cashback_loss_risk_byn numeric(12,2) DEFAULT 0 NOT NULL,
    days_seen integer DEFAULT 1 NOT NULL,
    first_seen_date date NOT NULL,
    last_seen_date date NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    edge_strength numeric(5,3) GENERATED ALWAYS AS (LEAST(1.0, (((0.4 * (repeat_ratio / 100.0)) + (0.3 *
CASE
    WHEN (orders_count > 0) THEN ((noncash_orders)::numeric / (orders_count)::numeric)
    ELSE (0)::numeric
END)) + (0.3 *
CASE
    WHEN (orders_count > 0) THEN ((short_trip_count)::numeric / (orders_count)::numeric)
    ELSE (0)::numeric
END)))) STORED
);


--
-- Name: graph_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_nodes (
    entity_id text NOT NULL,
    entity_type text NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL,
    total_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    total_noncash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    total_connections integer DEFAULT 0 NOT NULL,
    unique_partners integer DEFAULT 0 NOT NULL,
    risk_score_avg numeric(5,2) DEFAULT 0 NOT NULL,
    risk_score_max numeric(5,2) DEFAULT 0 NOT NULL,
    total_cashback_generated numeric(12,2) DEFAULT 0 NOT NULL,
    total_cashback_risk numeric(12,2) DEFAULT 0 NOT NULL,
    cluster_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT graph_nodes_entity_type_check CHECK ((entity_type = ANY (ARRAY['driver'::text, 'client'::text])))
);


--
-- Name: ip_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ip_links (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    ip_address text NOT NULL,
    first_seen date NOT NULL,
    last_seen date NOT NULL,
    CONSTRAINT ip_links_entity_type_check CHECK ((entity_type = ANY (ARRAY['driver'::text, 'client'::text])))
);


--
-- Name: ip_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ip_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ip_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ip_links_id_seq OWNED BY public.ip_links.id;


--
-- Name: ml_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_predictions (
    entity_type text NOT NULL,
    entity_id_a text NOT NULL,
    entity_id_b text DEFAULT ''::text NOT NULL,
    date date NOT NULL,
    model_version text NOT NULL,
    score numeric(6,4) NOT NULL,
    heuristic_score numeric(6,2),
    disagreement numeric(6,4),
    predicted_at timestamp with time zone DEFAULT now() NOT NULL,
    top_features jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: ml_training_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_training_runs (
    run_id bigint NOT NULL,
    model_version text NOT NULL,
    target_def text NOT NULL,
    n_train integer NOT NULL,
    n_test integer NOT NULL,
    n_pos_train integer DEFAULT 0 NOT NULL,
    n_pos_test integer DEFAULT 0 NOT NULL,
    auc numeric(6,4),
    pr_auc numeric(6,4),
    accuracy numeric(6,4),
    top_features jsonb DEFAULT '[]'::jsonb NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    model_type text DEFAULT 'weak_supervised'::text NOT NULL,
    entity_type text DEFAULT 'pair'::text NOT NULL,
    status text DEFAULT 'success'::text NOT NULL,
    model_path text,
    rows_count integer,
    positive_count integer,
    negative_count integer,
    precision_score numeric(6,4),
    recall numeric(6,4),
    f1_score numeric(6,4),
    roc_auc numeric(6,4),
    error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_by text,
    is_active boolean DEFAULT false NOT NULL,
    CONSTRAINT ml_training_runs_entity_type_check CHECK ((entity_type = ANY (ARRAY['pair'::text, 'driver'::text, 'client'::text, 'cluster'::text]))),
    CONSTRAINT ml_training_runs_model_type_check CHECK ((model_type = ANY (ARRAY['weak_supervised'::text, 'supervised'::text]))),
    CONSTRAINT ml_training_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])))
);


--
-- Name: ml_training_runs_run_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ml_training_runs_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_training_runs_run_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_training_runs_run_id_seq OWNED BY public.ml_training_runs.run_id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    order_id text NOT NULL,
    order_date date NOT NULL,
    created_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    gmv numeric(12,2),
    km numeric(8,2),
    client_id text,
    driver_id text,
    status text NOT NULL,
    payment_type text,
    payment_type2 text,
    car_class_create text,
    car_class_appoint text,
    is_now boolean,
    arrival_minutes numeric(6,2),
    trip_minutes numeric(6,2),
    lat_in double precision,
    lng_in double precision,
    lat_out double precision,
    lng_out double precision,
    batch_id text,
    raw jsonb,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone
);


--
-- Name: pair_risk_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pair_risk_daily (
    driver_id text NOT NULL,
    client_id text NOT NULL,
    date date NOT NULL,
    orders_count integer DEFAULT 0 NOT NULL,
    noncash_gmv numeric(12,2) DEFAULT 0 NOT NULL,
    repeat_ratio numeric(5,2) DEFAULT 0 NOT NULL,
    suspicious_ratio numeric(5,2) DEFAULT 0 NOT NULL,
    cashback_dependency numeric(5,2) DEFAULT 0 NOT NULL,
    total_risk numeric(5,2) DEFAULT 0 NOT NULL,
    collusion_loss_risk_byn numeric(12,2) DEFAULT 0 NOT NULL,
    signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    recomputed_at timestamp with time zone DEFAULT now() NOT NULL,
    cancel_after_accept_ratio numeric(5,4) DEFAULT 0 NOT NULL
);


--
-- Name: pii_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pii_access_log (
    id bigint NOT NULL,
    user_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    accessed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pii_access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pii_access_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pii_access_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pii_access_log_id_seq OWNED BY public.pii_access_log.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    id text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text
);


--
-- Name: shared_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_signals (
    id bigint NOT NULL,
    entity_a_type text NOT NULL,
    entity_a_id text NOT NULL,
    entity_b_type text NOT NULL,
    entity_b_id text NOT NULL,
    signal_type text NOT NULL,
    signal_value text NOT NULL,
    strength numeric(5,2) DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shared_signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['device'::text, 'ip'::text])))
);


--
-- Name: shared_signals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shared_signals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shared_signals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shared_signals_id_seq OWNED BY public.shared_signals.id;


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id integer NOT NULL,
    name text NOT NULL,
    start_hour smallint NOT NULL,
    end_hour smallint NOT NULL,
    payout_byn numeric(10,2) NOT NULL,
    weekday_mask smallint DEFAULT 127 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shifts_end_hour_check CHECK (((end_hour >= 1) AND (end_hour <= 24))),
    CONSTRAINT shifts_payout_byn_check CHECK ((payout_byn >= (0)::numeric)),
    CONSTRAINT shifts_start_hour_check CHECK (((start_hour >= 0) AND (start_hour <= 23)))
);


--
-- Name: shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shifts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shifts_id_seq OWNED BY public.shifts.id;


--
-- Name: upload_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_batches (
    id text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    uploaded_by text,
    source text,
    total_rows integer,
    inserted_rows integer,
    duplicate_rows integer,
    meta jsonb
);


--
-- Name: user_contacts_secure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_contacts_secure (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_contacts_secure_entity_type_check CHECK ((entity_type = ANY (ARRAY['driver'::text, 'client'::text])))
);


--
-- Name: user_contacts_secure_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_contacts_secure_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_contacts_secure_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_contacts_secure_id_seq OWNED BY public.user_contacts_secure.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    login text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'antifraud'::text, 'viewer'::text])))
);


--
-- Name: device_fingerprints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_fingerprints ALTER COLUMN id SET DEFAULT nextval('public.device_fingerprints_id_seq'::regclass);


--
-- Name: fraud_ticket_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_ticket_events ALTER COLUMN id SET DEFAULT nextval('public.fraud_ticket_events_id_seq'::regclass);


--
-- Name: fraud_tickets ticket_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_tickets ALTER COLUMN ticket_id SET DEFAULT nextval('public.fraud_tickets_ticket_id_seq'::regclass);


--
-- Name: fraud_training_labels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_training_labels ALTER COLUMN id SET DEFAULT nextval('public.fraud_training_labels_id_seq'::regclass);


--
-- Name: ip_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_links ALTER COLUMN id SET DEFAULT nextval('public.ip_links_id_seq'::regclass);


--
-- Name: ml_training_runs run_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_training_runs ALTER COLUMN run_id SET DEFAULT nextval('public.ml_training_runs_run_id_seq'::regclass);


--
-- Name: pii_access_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pii_access_log ALTER COLUMN id SET DEFAULT nextval('public.pii_access_log_id_seq'::regclass);


--
-- Name: shared_signals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_signals ALTER COLUMN id SET DEFAULT nextval('public.shared_signals_id_seq'::regclass);


--
-- Name: shifts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts ALTER COLUMN id SET DEFAULT nextval('public.shifts_id_seq'::regclass);


--
-- Name: user_contacts_secure id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contacts_secure ALTER COLUMN id SET DEFAULT nextval('public.user_contacts_secure_id_seq'::regclass);


--
-- Name: client_risk_daily client_risk_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_risk_daily
    ADD CONSTRAINT client_risk_daily_pkey PRIMARY KEY (client_id, date);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: daily_client_stats daily_client_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_client_stats
    ADD CONSTRAINT daily_client_stats_pkey PRIMARY KEY (client_id, date);


--
-- Name: daily_driver_stats daily_driver_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_driver_stats
    ADD CONSTRAINT daily_driver_stats_pkey PRIMARY KEY (driver_id, date);


--
-- Name: daily_pair_stats daily_pair_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_pair_stats
    ADD CONSTRAINT daily_pair_stats_pkey PRIMARY KEY (driver_id, client_id, date);


--
-- Name: device_fingerprints device_fingerprints_entity_type_entity_id_device_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_fingerprints
    ADD CONSTRAINT device_fingerprints_entity_type_entity_id_device_hash_key UNIQUE (entity_type, entity_id, device_hash);


--
-- Name: device_fingerprints device_fingerprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_fingerprints
    ADD CONSTRAINT device_fingerprints_pkey PRIMARY KEY (id);


--
-- Name: driver_risk_daily driver_risk_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_risk_daily
    ADD CONSTRAINT driver_risk_daily_pkey PRIMARY KEY (driver_id, date);


--
-- Name: driver_shift_attendance driver_shift_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shift_attendance
    ADD CONSTRAINT driver_shift_attendance_pkey PRIMARY KEY (driver_id, date, shift_id);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: fraud_ticket_events fraud_ticket_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_ticket_events
    ADD CONSTRAINT fraud_ticket_events_pkey PRIMARY KEY (id);


--
-- Name: fraud_tickets fraud_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_tickets
    ADD CONSTRAINT fraud_tickets_pkey PRIMARY KEY (ticket_id);


--
-- Name: fraud_training_labels fraud_training_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_training_labels
    ADD CONSTRAINT fraud_training_labels_pkey PRIMARY KEY (id);


--
-- Name: graph_clusters graph_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_clusters
    ADD CONSTRAINT graph_clusters_pkey PRIMARY KEY (cluster_id);


--
-- Name: graph_edges graph_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_edges
    ADD CONSTRAINT graph_edges_pkey PRIMARY KEY (driver_id, client_id, date);


--
-- Name: graph_nodes graph_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_nodes
    ADD CONSTRAINT graph_nodes_pkey PRIMARY KEY (entity_id, entity_type);


--
-- Name: ip_links ip_links_entity_type_entity_id_ip_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_links
    ADD CONSTRAINT ip_links_entity_type_entity_id_ip_address_key UNIQUE (entity_type, entity_id, ip_address);


--
-- Name: ip_links ip_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_links
    ADD CONSTRAINT ip_links_pkey PRIMARY KEY (id);


--
-- Name: ml_predictions ml_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT ml_predictions_pkey PRIMARY KEY (entity_type, entity_id_a, entity_id_b, date);


--
-- Name: ml_training_runs ml_training_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_training_runs
    ADD CONSTRAINT ml_training_runs_pkey PRIMARY KEY (run_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


--
-- Name: pair_risk_daily pair_risk_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pair_risk_daily
    ADD CONSTRAINT pair_risk_daily_pkey PRIMARY KEY (driver_id, client_id, date);


--
-- Name: pii_access_log pii_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pii_access_log
    ADD CONSTRAINT pii_access_log_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: shared_signals shared_signals_entity_a_type_entity_a_id_entity_b_type_enti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_signals
    ADD CONSTRAINT shared_signals_entity_a_type_entity_a_id_entity_b_type_enti_key UNIQUE (entity_a_type, entity_a_id, entity_b_type, entity_b_id, signal_type, signal_value);


--
-- Name: shared_signals shared_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_signals
    ADD CONSTRAINT shared_signals_pkey PRIMARY KEY (id);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: upload_batches upload_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_batches
    ADD CONSTRAINT upload_batches_pkey PRIMARY KEY (id);


--
-- Name: user_contacts_secure user_contacts_secure_entity_type_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contacts_secure
    ADD CONSTRAINT user_contacts_secure_entity_type_entity_id_key UNIQUE (entity_type, entity_id);


--
-- Name: user_contacts_secure user_contacts_secure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contacts_secure
    ADD CONSTRAINT user_contacts_secure_pkey PRIMARY KEY (id);


--
-- Name: users users_login_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_login_key UNIQUE (login);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_crd_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crd_date ON public.client_risk_daily USING btree (date);


--
-- Name: idx_crd_money_at_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crd_money_at_risk ON public.client_risk_daily USING btree (date, money_at_risk_byn DESC);


--
-- Name: idx_crd_total_orders; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crd_total_orders ON public.client_risk_daily USING btree (date, total_orders DESC);


--
-- Name: idx_dcs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dcs_date ON public.daily_client_stats USING btree (date);


--
-- Name: idx_dds_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dds_date ON public.daily_driver_stats USING btree (date);


--
-- Name: idx_device_fp_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_fp_entity ON public.device_fingerprints USING btree (entity_type, entity_id);


--
-- Name: idx_device_fp_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_fp_hash ON public.device_fingerprints USING btree (device_hash);


--
-- Name: idx_dps_client_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dps_client_date ON public.daily_pair_stats USING btree (client_id, date);


--
-- Name: idx_dps_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dps_date ON public.daily_pair_stats USING btree (date);


--
-- Name: idx_dps_driver_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dps_driver_date ON public.daily_pair_stats USING btree (driver_id, date);


--
-- Name: idx_dsa_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsa_date ON public.driver_shift_attendance USING btree (date);


--
-- Name: idx_dsa_date_qualified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsa_date_qualified ON public.driver_shift_attendance USING btree (date, qualified);


--
-- Name: idx_fraud_tickets_date_status_money; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fraud_tickets_date_status_money ON public.fraud_tickets USING btree (date, status, money_at_risk_byn DESC);


--
-- Name: idx_fraud_tickets_status_priority_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fraud_tickets_status_priority_created ON public.fraud_tickets USING btree (status, priority, created_at);


--
-- Name: idx_fraud_tickets_updated_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fraud_tickets_updated_status ON public.fraud_tickets USING btree (updated_at DESC, status);


--
-- Name: idx_gc_loss; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gc_loss ON public.graph_clusters USING btree (total_collusion_loss_risk DESC);


--
-- Name: idx_gc_suspicious; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gc_suspicious ON public.graph_clusters USING btree (is_suspicious, total_collusion_loss_risk DESC);


--
-- Name: idx_ge_client_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ge_client_date ON public.graph_edges USING btree (client_id, date);


--
-- Name: idx_ge_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ge_date ON public.graph_edges USING btree (date);


--
-- Name: idx_ge_driver_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ge_driver_date ON public.graph_edges USING btree (driver_id, date);


--
-- Name: idx_ge_strength; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ge_strength ON public.graph_edges USING btree (edge_strength DESC);


--
-- Name: idx_gn_cluster; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gn_cluster ON public.graph_nodes USING btree (cluster_id);


--
-- Name: idx_gn_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gn_risk ON public.graph_nodes USING btree (risk_score_max DESC);


--
-- Name: idx_gn_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gn_type ON public.graph_nodes USING btree (entity_type);


--
-- Name: idx_ip_links_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_links_entity ON public.ip_links USING btree (entity_type, entity_id);


--
-- Name: idx_ip_links_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_links_ip ON public.ip_links USING btree (ip_address);


--
-- Name: idx_ml_predictions_pair_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ml_predictions_pair_date ON public.ml_predictions USING btree (entity_id_a, entity_id_b, date DESC, predicted_at DESC);


--
-- Name: idx_orders_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_batch ON public.orders USING btree (batch_id);


--
-- Name: idx_orders_client_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_client_date ON public.orders USING btree (client_id, order_date);


--
-- Name: idx_orders_driver_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_driver_date ON public.orders USING btree (driver_id, order_date);


--
-- Name: idx_orders_pair_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pair_date ON public.orders USING btree (driver_id, client_id, order_date);


--
-- Name: idx_orders_status_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_date ON public.orders USING btree (status, order_date);


--
-- Name: idx_orders_status_driver_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_driver_date ON public.orders USING btree (status, driver_id, order_date);


--
-- Name: idx_pair_risk_daily_driver_client_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pair_risk_daily_driver_client_date ON public.pair_risk_daily USING btree (driver_id, client_id, date DESC);


--
-- Name: idx_pii_access_log_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pii_access_log_user ON public.pii_access_log USING btree (user_id, accessed_at DESC);


--
-- Name: idx_prd_client_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prd_client_date ON public.pair_risk_daily USING btree (client_id, date);


--
-- Name: idx_prd_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prd_date ON public.pair_risk_daily USING btree (date);


--
-- Name: idx_prd_driver_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prd_driver_date ON public.pair_risk_daily USING btree (driver_id, date);


--
-- Name: idx_prd_loss; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prd_loss ON public.pair_risk_daily USING btree (date, collusion_loss_risk_byn DESC);


--
-- Name: idx_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expires ON public.sessions USING btree (expires_at);


--
-- Name: idx_shared_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_a ON public.shared_signals USING btree (entity_a_type, entity_a_id);


--
-- Name: idx_shared_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_b ON public.shared_signals USING btree (entity_b_type, entity_b_id);


--
-- Name: idx_shared_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_type ON public.shared_signals USING btree (signal_type);


--
-- Name: idx_user_contacts_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contacts_entity ON public.user_contacts_secure USING btree (entity_type, entity_id);


--
-- Name: ix_driver_risk_date_money; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_driver_risk_date_money ON public.driver_risk_daily USING btree (date, money_at_risk_byn DESC);


--
-- Name: ix_driver_risk_date_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_driver_risk_date_total ON public.driver_risk_daily USING btree (date, total_risk DESC);


--
-- Name: ix_fraud_ticket_events_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_ticket_events_ticket ON public.fraud_ticket_events USING btree (ticket_id, created_at);


--
-- Name: ix_fraud_tickets_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_tickets_client ON public.fraud_tickets USING btree (client_id) WHERE (client_id IS NOT NULL);


--
-- Name: ix_fraud_tickets_date_money; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_tickets_date_money ON public.fraud_tickets USING btree (date, money_at_risk_byn DESC);


--
-- Name: ix_fraud_tickets_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_tickets_driver ON public.fraud_tickets USING btree (driver_id) WHERE (driver_id IS NOT NULL);


--
-- Name: ix_fraud_tickets_label_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_tickets_label_status ON public.fraud_tickets USING btree (label_status, date DESC);


--
-- Name: ix_fraud_tickets_priority_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_tickets_priority_date ON public.fraud_tickets USING btree (priority, date);


--
-- Name: ix_fraud_tickets_status_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_tickets_status_date ON public.fraud_tickets USING btree (status, date);


--
-- Name: ix_fraud_training_labels_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_training_labels_entity ON public.fraud_training_labels USING btree (entity_type, entity_key, date DESC);


--
-- Name: ix_fraud_training_labels_label_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fraud_training_labels_label_date ON public.fraud_training_labels USING btree (label, date DESC);


--
-- Name: ix_ml_training_runs_status_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ml_training_runs_status_started ON public.ml_training_runs USING btree (status, started_at DESC);


--
-- Name: ml_predictions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_predictions_date_idx ON public.ml_predictions USING btree (date DESC);


--
-- Name: ml_predictions_disagreement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_predictions_disagreement_idx ON public.ml_predictions USING btree (entity_type, disagreement DESC NULLS LAST);


--
-- Name: ml_predictions_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_predictions_score_idx ON public.ml_predictions USING btree (entity_type, score DESC);


--
-- Name: ml_training_runs_model_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_training_runs_model_version_idx ON public.ml_training_runs USING btree (model_version);


--
-- Name: uq_fraud_tickets_entity_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fraud_tickets_entity_date ON public.fraud_tickets USING btree (entity_key, date);


--
-- Name: uq_fraud_training_labels; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fraud_training_labels ON public.fraud_training_labels USING btree (entity_type, entity_key, date, COALESCE(source_ticket_id, (0)::bigint));


--
-- Name: uq_ml_training_runs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ml_training_runs_active ON public.ml_training_runs USING btree (model_type, entity_type) WHERE (is_active = true);


--
-- Name: driver_shift_attendance driver_shift_attendance_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shift_attendance
    ADD CONSTRAINT driver_shift_attendance_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: driver_shift_attendance driver_shift_attendance_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shift_attendance
    ADD CONSTRAINT driver_shift_attendance_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: fraud_ticket_events fraud_ticket_events_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_ticket_events
    ADD CONSTRAINT fraud_ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.fraud_tickets(ticket_id) ON DELETE CASCADE;


--
-- Name: fraud_training_labels fraud_training_labels_source_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_training_labels
    ADD CONSTRAINT fraud_training_labels_source_ticket_id_fkey FOREIGN KEY (source_ticket_id) REFERENCES public.fraud_tickets(ticket_id) ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 7KciezzjcTLa7lfxkoLovxF1Fcps2sKRL8aakTHhL6H3FBA7hwryoXjNTSvzged

