# -*- coding: utf-8 -*-
"""Prompt templates for insight-aware ingestion.

This module defines a universal header that enforces strict JSON output
and a dictionary of prompt templates keyed by operation name.
"""

UNIVERSAL_HEADER = (
    "You are a careful extractor. Output a SINGLE JSON object, with NO prose and NO markdown.\n"
    "Follow the provided JSON shape exactly. If unsure about a field, use null or [].\n"
    "Do not add extra keys. Do not include explanations or reasoning.\n"
    "Return ASCII only. Ensure valid UTF-8 and strict JSON.\n"
)

PROMPTS = {
    # ---------- 0. Genre detection ----------
    "genre_detect": (
        "Classify the document.\n"
        'Return JSON: {"genre": "<fiction|paper|tech_report|default>", "confidence": <0-1>}\n'
        "Metadata:\n"
        'language: "<lang>"\n'
        'filetype: "<pdf/md/docx/html>"\n'
        "has_toc: <true|false>\n"
        "has_figures: <true|false>\n"
        "Text sample:\n"
        '"<up to 2000 chars>"'
    ),

    # ---------- 1. Role tagging (genre aware) ----------
    "fiction.role_tag": (
        "Identify roles in the passage.\n"
        'Allowed roles: ["beat","conflict","motive","world_rule","foreshadowing",'
        '"motif","inconsistency","theme","question"].\n'
        'Return JSON: {"roles":[{"role":"<allowed role>","evidence":"<snippet>"}, ...]} '
        "(max 3 items).\n"
        'Passage:\n"<text>"'
    ),

    "paper.role_tag": (
        "Identify roles in the passage.\n"
        'Allowed roles: ["claim","hypothesis","assumption","method","parameter",'
        '"result","limitation","dataset","metric","threat_to_validity"].\n'
        'Return JSON: {"roles":[{"role":"<allowed role>","evidence":"<snippet>"}, ...]} '
        "(max 3 items).\n"
        'Passage:\n"<text>"'
    ),

    "tech_report.role_tag": (
        "Identify roles in the passage.\n"
        'Allowed roles: ["requirement","decision","rationale","constraint","risk",'
        '"mitigation","kpi","tradeoff","open_question"].\n'
        'Return JSON: {"roles":[{"role":"<allowed role>","evidence":"<snippet>"}, ...]} '
        "(max 3 items).\n"
        'Passage:\n"<text>"'
    ),

    "default.role_tag": (
        "Identify roles in the passage.\n"
        'Allowed roles: ["claim","evidence","assumption","constraint","example",'
        '"counterexample","question","mechanism","tradeoff"].\n'
        'Return JSON: {"roles":[{"role":"<allowed role>","evidence":"<snippet>"}, ...]} '
        "(max 3 items).\n"
        'Passage:\n"<text>"'
    ),

    # ---------- 2. Light processing ----------
    "universal.summarize": (
        "Summarize the passage.\n"
        'Return JSON: {"summary_sentence":"<<=40 words>",\n'
        '"summary_100":"<<=100 words>"}.\n'
        'Passage:\n"<text>"'
    ),

    "universal.entities_and_vars": (
        "Extract named entities and explicit variables.\n"
        'Return JSON: {"entities":[],"variables":[]} (each up to 10 items).\n'
        'Passage:\n"<text>"'
    ),

    # ---------- 3. Fiction lenses ----------
    "fiction.counterfactual_plot": (
        "Imagine a counterfactual for the scene.\n"
        'Return JSON: {"counterfactual":"<altered event>",\n'
        '"predicted_outcome":"<result>","confidence":<0-1>}.\n'
        'Scene:\n"<scene>"'
    ),

    "fiction.character_goal_swap": (
        "Swap goals of the main characters and describe the tension.\n"
        'Return JSON: {"swap_description":"<swap>",\n'
        '"effect":"<new conflict or insight>","confidence":<0-1>}.\n'
        'Scene:\n"<scene>"'
    ),

    "fiction.timeline_weave": (
        "Pick two events that could be interwoven to raise tension.\n"
        'Return JSON: {"events":["<event A>","<event B>"],\n'
        '"weave_effect":"<impact>","confidence":<0-1>}.\n'
        'Excerpt:\n"<excerpt>"'
    ),

    # ---------- 4. Paper lenses ----------
    "paper.boundary_case": (
        "Consider boundary or extreme cases.\n"
        'Return JSON: {"boundary_case":"<condition>",\n'
        '"expected_behavior":"<outcome>","confidence":<0-1>}.\n'
        'Section:\n"<section>"'
    ),

    "paper.ablation_thought": (
        "Suggest an ablation experiment.\n"
        'Return JSON: {"component":"<what to remove>",\n'
        '"expected_change":"<metric impact>","confidence":<0-1>}.\n'
        'Method snippet:\n"<method_snippet>"'
    ),

    "paper.replication_plan": (
        "Sketch a minimal replication plan.\n"
        'Return JSON: {"dataset":"<dataset>","procedure":"<key steps>",\n'
        '"metrics":["<metric1>",...],"confidence":<0-1>}.\n'
        'Result excerpt:\n"<result_snippet>"'
    ),

    "paper.mechanism_analogy": (
        "Map the mechanism to an analogous domain.\n"
        'Return JSON: {"mechanism":"<abstract mechanism>",\n'
        '"analogy":"<domain and mapping>","confidence":<0-1>}.\n'
        'Passage:\n"<passage>"'
    ),

    # ---------- 5. Tech-report lenses ----------
    "tech_report.risk_matrix_think": (
        "Assess risk and position it on a risk matrix.\n"
        'Return JSON: {"risk":"<description>","likelihood":"<low|medium|high>",\n'
        '"impact":"<low|medium|high>","mitigation":"<action>","confidence":<0-1>}.\n'
        'Decision entry:\n"<decision_entry>"'
    ),

    "tech_report.tradeoff_flip": (
        "Invert the stated trade-off and predict the consequence.\n"
        'Return JSON: {"flipped_tradeoff":"<new prioritization>",\n'
        '"projected_effect":"<result>","confidence":<0-1>}.\n'
        'Decision entry:\n"<decision_entry>"'
    ),

    "tech_report.kpi_sensitivity": (
        "Estimate KPI sensitivity to a variable shift.\n"
        'Return JSON: {"kpi":"<kpi name>","variable":"<related variable>",\n'
        '"sensitivity":"<qualitative relation>","confidence":<0-1>}.\n'
        'Context:\n"<kpi_context>"'
    ),

    "tech_report.failure_story": (
        "Describe a hypothetical failure incident.\n"
        'Return JSON: {"failure_scenario":"<what goes wrong>",\n'
        '"root_cause":"<likely cause>","preventive_step":"<mitigation>",\n'
        '"confidence":<0-1>}.\n'
        'Incident note:\n"<incident_note>"'
    ),

    # ---------- 6. Default lenses ----------
    "default.counterfactual": (
        "Propose a simple counterfactual.\n"
        'Return JSON: {"counterfactual":"<altered assumption>",\n'
        '"effect":"<predicted change>","confidence":<0-1>}.\n'
        'Chunk:\n"<chunk>"'
    ),

    "default.extremes": (
        "Consider an extreme condition.\n"
        'Return JSON: {"extreme_condition":"<condition>",\n'
        '"system_response":"<what would happen>","confidence":<0-1>}.\n'
        'Chunk:\n"<chunk>"'
    ),

    "default.analogy": (
        "Provide an analogy from another domain.\n"
        'Return JSON: {"analogy":"<analogy statement>",\n'
        '"mapping":"<key correspondences>","confidence":<0-1>}.\n'
        'Chunk:\n"<chunk>"'
    ),

    "default.cases_and_questions": (
        "Produce one positive example, one negative example, and three questions.\n"
        'Return JSON: {"positive_case":"<example>","negative_case":"<counterexample>",\n'
        '"questions":["<clarifying>","<challenging>","<extending>"],\n'
        '"confidence":<0-1>}.\n'
        'Chunk:\n"<chunk>"'
    ),
}
