/**
 * Per-curation Collections modal.
 *
 * Published memberships come from the root API and are always read-only here.
 * Draft mutations go through the Admin bridge with the Collector Bearer token;
 * this module deliberately has no IndexedDB or SyncManager integration.
 */
window.CollectionsModal = (function() {
    'use strict';

    const POLL_INTERVAL_MS = 1000;
    const POLL_ATTEMPTS = 30;

    function curationLabel(curation) {
        return curation?.restaurant_name || curation?.name || curation?.curation_id || 'this curation';
    }

    function makeText(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        element.textContent = text;
        return element;
    }

    function errorMessage(error) {
        if (error?.code === 'offline' || error?.code === 'network_error') return 'Collections are available only while you are online.';
        if (error?.status === 401) return 'Sign in to view Collections for this curation.';
        if (error?.status === 403) return 'You can view published Collections, but changing a draft requires an administrator role.';
        if (error?.status === 423) return 'This Collection is publishing. Wait for it to finish before changing the draft.';
        if (error?.status === 412) return 'This Collection changed while this modal was open. The latest draft was loaded again.';
        return 'Collections could not be loaded right now. Try again shortly.';
    }

    function createShell(curation) {
        const root = document.createElement('section');
        root.className = 'collections-modal';
        root.dataset.curationId = curation.curation_id;

        const description = makeText('p', 'collections-modal__description', `Manage the Collections containing ${curationLabel(curation)}.`);
        root.appendChild(description);

        const publishedSection = document.createElement('section');
        publishedSection.className = 'collections-modal__section';
        publishedSection.append(makeText('h3', 'collections-modal__heading', 'Published Collections'));
        const published = makeText('div', 'collections-modal__loading', 'Loading published memberships…');
        published.setAttribute('aria-live', 'polite');
        publishedSection.appendChild(published);

        const draftsSection = document.createElement('section');
        draftsSection.className = 'collections-modal__section';
        draftsSection.append(makeText('h3', 'collections-modal__heading', 'Collection drafts'));
        const drafts = makeText('div', 'collections-modal__loading', 'Checking draft permissions…');
        drafts.setAttribute('aria-live', 'polite');
        draftsSection.appendChild(drafts);

        const status = makeText('div', 'collections-modal__status', '');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        root.append(publishedSection, draftsSection, status);
        return { root, published, drafts, status };
    }

    function renderPublished(container, associations) {
        container.replaceChildren();
        if (!associations.length) {
            container.appendChild(makeText('p', 'collections-modal__empty', 'This curation is not in any published Collection.'));
            return;
        }
        const list = document.createElement('ul');
        list.className = 'collections-modal__published-list';
        associations.forEach((association) => {
            const item = document.createElement('li');
            item.className = 'collections-modal__published-item';
            item.append(
                makeText('strong', '', association.title || association.slug),
                makeText('span', 'collections-modal__slug', `/${association.slug}`),
                makeText('span', 'collections-modal__version', `Published v${association.current_published_version}`)
            );
            list.appendChild(item);
        });
        container.appendChild(list);
    }

    function renderDraftOptions(container, options, onMutate) {
        container.replaceChildren();
        if (!options.length) {
            container.appendChild(makeText('p', 'collections-modal__empty', 'No editable Collection drafts are available.'));
            return;
        }
        const list = document.createElement('ul');
        list.className = 'collections-modal__draft-list';
        options.forEach((option) => {
            const item = document.createElement('li');
            item.className = 'collections-modal__draft-item';
            const copy = document.createElement('div');
            copy.className = 'collections-modal__draft-copy';
            copy.append(
                makeText('strong', '', option.title || option.slug),
                makeText('span', 'collections-modal__slug', `/${option.slug}`),
                makeText('span', 'collections-modal__draft-state', `Draft r${option.draftRevision}${option.draftState === 'dirty' ? ' · changed' : ''}`)
            );
            const action = option.desiredState === 'remove' ? 'Remove from draft' : 'Add to draft';
            const button = makeText('button', 'collections-modal__action', action);
            button.type = 'button';
            button.disabled = Boolean(option.locked);
            button.dataset.collectionId = option.collectionId;
            button.dataset.action = option.desiredState === 'remove' ? 'remove' : 'add';
            button.addEventListener('click', () => onMutate(option, button));
            item.append(copy, button);
            list.appendChild(item);
        });
        container.appendChild(list);
    }

    async function waitForOperation(service, operationId) {
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            const operation = await service.getOperation(operationId);
            if (['completed', 'completed_with_skips', 'cancelled', 'failed', 'conflicted', 'authorization_revoked'].includes(operation.status)) return operation;
        }
        return { status: 'queued' };
    }

    async function loadDrafts(service, curation, shell) {
        try {
            const response = await service.getDraftOptions(curation.curation_id);
            const options = Array.isArray(response?.items) ? response.items : [];
            renderDraftOptions(shell.drafts, options, async (option, button) => {
                button.disabled = true;
                shell.status.textContent = 'Saving draft change…';
                try {
                    const operation = await service.createSingleCurationOperation({
                        collectionId: option.collectionId,
                        curationId: curation.curation_id,
                        action: option.desiredState === 'remove' ? 'remove' : 'add',
                        draftRevision: option.draftRevision
                    });
                    shell.status.textContent = 'Draft change queued.';
                    const finalOperation = await waitForOperation(service, operation.id);
                    if (finalOperation.status === 'completed' || finalOperation.status === 'completed_with_skips') {
                        shell.status.textContent = 'Draft updated.';
                        await loadDrafts(service, curation, shell);
                    } else if (finalOperation.status === 'queued') {
                        shell.status.textContent = 'Draft change is still processing. You can close this modal.';
                    } else {
                        shell.status.textContent = `Draft change stopped: ${finalOperation.errorCode || finalOperation.status}.`;
                    }
                } catch (error) {
                    shell.status.textContent = errorMessage(error);
                    if (error?.status === 412) await loadDrafts(service, curation, shell);
                    else button.disabled = false;
                }
            });
        } catch (error) {
            shell.drafts.replaceChildren(makeText('p', 'collections-modal__notice', errorMessage(error)));
        }
    }

    /**
     * Reads the role from AuthService on every call. This is a hint used only
     * to avoid asking the admin-only endpoint for a guaranteed 403; the real
     * authority is the server, which still removes the controls on 403.
     */
    function isAdminHint() {
        return window.AuthService?.getCurrentUser?.()?.role === 'admin';
    }

    async function load(curation, shell) {
        const service = window.CollectionsService;
        if (!service) {
            shell.published.replaceChildren(makeText('p', 'collections-modal__notice', 'Collections is not available in this build.'));
            shell.drafts.replaceChildren();
            return;
        }
        try {
            const response = await service.getPublishedAssociations(curation.curation_id);
            renderPublished(shell.published, Array.isArray(response?.items) ? response.items : []);
        } catch (error) {
            shell.published.replaceChildren(makeText('p', 'collections-modal__notice', errorMessage(error)));
        }
        if (!isAdminHint()) {
            // Published rows stay visible; no draft control is even requested.
            shell.drafts.replaceChildren(makeText('p', 'collections-modal__notice', 'Changing a Collection draft requires an administrator role.'));
            return;
        }
        await loadDrafts(service, curation, shell);
    }

    function open(curation) {
        if (!curation?.curation_id || !window.ModalManager) return null;
        const shell = createShell(curation);
        const id = window.ModalManager.open({
            title: 'Collections', content: shell.root, size: 'lg', closeOnOverlay: true, closeOnEscape: true
        });
        load(curation, shell).catch(() => {});
        return id;
    }

    return { open };
})();
